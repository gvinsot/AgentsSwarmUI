import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw, AlertCircle, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import * as d3 from 'd3';
import api from '../api';

// ── Types ───────────────────────────────────────────────────────────────────

interface WorkflowColumn {
  id: string;
  label: string;
  color: string;
}

interface WorkflowAction {
  type: string;
  instructions?: string;
  role?: string;
  mode?: string;
  targetBoard?: string;
  targetColumn?: string;
  [key: string]: any;
}

interface WorkflowTransition {
  from: string;
  trigger: string;
  actions: WorkflowAction[];
}

interface BoardWorkflow {
  columns: WorkflowColumn[];
  transitions: WorkflowTransition[];
  version?: number;
}

interface Board {
  id: string;
  name: string;
  user_id: string;
  username?: string;
  display_name?: string;
  workflow: BoardWorkflow;
  is_default: boolean;
}

interface BoardNode {
  id: string;
  board: Board;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoardEdge {
  source: string;
  target: string;
  label: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function detectRelations(boards: Board[]): BoardEdge[] {
  const edges: BoardEdge[] = [];
  const boardNames = boards.map(b => ({ id: b.id, name: b.name.toLowerCase() }));

  for (const board of boards) {
    if (!board.workflow?.transitions) continue;

    for (const transition of board.workflow.transitions) {
      for (const action of transition.actions || []) {
        // Check instructions text for references to other board names
        const instrText = (action.instructions || '').toLowerCase();
        // Check targetBoard field (for move_to_board actions)
        const targetBoardId = action.targetBoard;

        if (targetBoardId) {
          const target = boards.find(b => b.id === targetBoardId);
          if (target && target.id !== board.id) {
            const exists = edges.some(e => e.source === board.id && e.target === target.id);
            if (!exists) {
              edges.push({ source: board.id, target: target.id, label: action.type || 'link' });
            }
          }
        }

        // Detect name-based references in instructions
        if (instrText) {
          for (const other of boardNames) {
            if (other.id === board.id) continue;
            if (other.name.length < 3) continue; // skip very short names
            if (instrText.includes(other.name)) {
              const exists = edges.some(e => e.source === board.id && e.target === other.id);
              if (!exists) {
                edges.push({ source: board.id, target: other.id, label: 'references' });
              }
            }
          }
        }
      }
    }
  }

  return edges;
}

const NODE_WIDTH = 240;
const NODE_HEADER_HEIGHT = 40;
const STEP_HEIGHT = 28;
const NODE_PADDING = 8;

function calcNodeHeight(board: Board): number {
  const cols = board.workflow?.columns?.length || 0;
  return NODE_HEADER_HEIGHT + cols * STEP_HEIGHT + NODE_PADDING * 2;
}

// ── Component ───────────────────────────────────────────────────────────────

export default function ProcessesView() {
  const [boards, setBoards] = useState<Board[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<Board | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const fetchBoards = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAllBoardsAdmin();
      setBoards(data || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load boards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBoards(); }, [fetchBoards]);

  // D3 graph rendering
  useEffect(() => {
    if (!boards.length || !svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    svg.attr('width', width).attr('height', height);

    // Calculate layout — arrange boards in a grid
    const edges = detectRelations(boards);
    const gap = 60;
    const cols = Math.max(1, Math.floor(Math.sqrt(boards.length)));
    const nodes: BoardNode[] = boards.map((board, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const h = calcNodeHeight(board);
      return {
        id: board.id,
        board,
        x: gap + col * (NODE_WIDTH + gap),
        y: gap + row * (220 + gap),
        width: NODE_WIDTH,
        height: h,
      };
    });

    // Create zoomable group
    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 3])
      .on('zoom', (event) => g.attr('transform', event.transform));

    svg.call(zoom);
    zoomRef.current = zoom;

    // Auto-fit
    const totalWidth = (cols) * (NODE_WIDTH + gap) + gap;
    const totalRows = Math.ceil(boards.length / cols);
    const totalHeight = totalRows * (220 + gap) + gap;
    const scaleX = width / totalWidth;
    const scaleY = height / totalHeight;
    const scale = Math.min(scaleX, scaleY, 1) * 0.9;
    const tx = (width - totalWidth * scale) / 2;
    const ty = (height - totalHeight * scale) / 2;
    svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));

    // Draw edges
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Arrow marker
    svg.append('defs').append('marker')
      .attr('id', 'arrowhead')
      .attr('viewBox', '0 0 10 7')
      .attr('refX', 10)
      .attr('refY', 3.5)
      .attr('markerWidth', 8)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('polygon')
      .attr('points', '0 0, 10 3.5, 0 7')
      .attr('fill', '#6366f1');

    for (const edge of edges) {
      const src = nodeMap.get(edge.source);
      const tgt = nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const sx = src.x + src.width;
      const sy = src.y + src.height / 2;
      const tx = tgt.x;
      const ty = tgt.y + tgt.height / 2;
      const mx = (sx + tx) / 2;

      g.append('path')
        .attr('d', `M ${sx} ${sy} C ${mx} ${sy}, ${mx} ${ty}, ${tx} ${ty}`)
        .attr('fill', 'none')
        .attr('stroke', '#6366f1')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,3')
        .attr('marker-end', 'url(#arrowhead)')
        .attr('opacity', 0.7);

      // Edge label
      g.append('text')
        .attr('x', mx)
        .attr('y', (sy + ty) / 2 - 8)
        .attr('text-anchor', 'middle')
        .attr('fill', '#818cf8')
        .attr('font-size', '10px')
        .text(edge.label);
    }

    // Draw board nodes
    for (const node of nodes) {
      const group = g.append('g')
        .attr('transform', `translate(${node.x}, ${node.y})`)
        .attr('cursor', 'pointer')
        .on('click', () => setSelectedBoard(prev => prev?.id === node.board.id ? null : node.board));

      // Card background
      group.append('rect')
        .attr('width', node.width)
        .attr('height', node.height)
        .attr('rx', 10)
        .attr('fill', '#1e1e2e')
        .attr('stroke', '#333350')
        .attr('stroke-width', 1.5);

      // Header bar
      group.append('rect')
        .attr('width', node.width)
        .attr('height', NODE_HEADER_HEIGHT)
        .attr('rx', 10)
        .attr('fill', node.board.is_default ? '#4f46e5' : '#2d2d44');

      // Clip bottom corners of header
      group.append('rect')
        .attr('y', NODE_HEADER_HEIGHT - 10)
        .attr('width', node.width)
        .attr('height', 10)
        .attr('fill', node.board.is_default ? '#4f46e5' : '#2d2d44');

      // Board name
      group.append('text')
        .attr('x', 12)
        .attr('y', 25)
        .attr('fill', '#e2e8f0')
        .attr('font-size', '13px')
        .attr('font-weight', '600')
        .text(node.board.name.length > 28 ? node.board.name.slice(0, 26) + '...' : node.board.name);

      // Owner badge
      const owner = node.board.display_name || node.board.username || '?';
      group.append('text')
        .attr('x', node.width - 10)
        .attr('y', 25)
        .attr('text-anchor', 'end')
        .attr('fill', 'rgba(255,255,255,0.5)')
        .attr('font-size', '10px')
        .text(owner.length > 12 ? owner.slice(0, 10) + '..' : owner);

      // Workflow columns (steps)
      const columns = node.board.workflow?.columns || [];
      columns.forEach((col, i) => {
        const cy = NODE_HEADER_HEIGHT + NODE_PADDING + i * STEP_HEIGHT;

        // Color dot
        group.append('circle')
          .attr('cx', 16)
          .attr('cy', cy + STEP_HEIGHT / 2)
          .attr('r', 5)
          .attr('fill', col.color || '#6b7280');

        // Step label
        group.append('text')
          .attr('x', 28)
          .attr('y', cy + STEP_HEIGHT / 2 + 4)
          .attr('fill', '#a1a1b5')
          .attr('font-size', '11px')
          .text(col.label);

        // Arrow between steps
        if (i < columns.length - 1) {
          group.append('line')
            .attr('x1', 16)
            .attr('y1', cy + STEP_HEIGHT / 2 + 7)
            .attr('x2', 16)
            .attr('y2', cy + STEP_HEIGHT + STEP_HEIGHT / 2 - 7)
            .attr('stroke', '#444460')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '2,2');
        }

        // Transition indicator (if there are actions)
        const trans = node.board.workflow?.transitions?.find(t => t.from === col.id);
        if (trans && trans.actions?.length > 0) {
          const hasAgent = trans.actions.some(a => a.type === 'run_agent');
          const hasMove = trans.actions.some(a => a.type === 'change_status' || a.type === 'move_to_board');

          if (hasAgent) {
            group.append('rect')
              .attr('x', node.width - 50)
              .attr('y', cy + 4)
              .attr('width', 38)
              .attr('height', 18)
              .attr('rx', 4)
              .attr('fill', 'rgba(99, 102, 241, 0.15)');
            group.append('text')
              .attr('x', node.width - 31)
              .attr('y', cy + 16)
              .attr('text-anchor', 'middle')
              .attr('fill', '#818cf8')
              .attr('font-size', '9px')
              .text('agent');
          }
          if (hasMove) {
            const offset = hasAgent ? 44 : 0;
            group.append('rect')
              .attr('x', node.width - 50 - offset)
              .attr('y', cy + 4)
              .attr('width', 38)
              .attr('height', 18)
              .attr('rx', 4)
              .attr('fill', 'rgba(234, 179, 8, 0.15)');
            group.append('text')
              .attr('x', node.width - 31 - offset)
              .attr('y', cy + 16)
              .attr('text-anchor', 'middle')
              .attr('fill', '#eab308')
              .attr('font-size', '9px')
              .text('move');
          }
        }
      });

      // Hover effect
      group.on('mouseenter', function() {
        d3.select(this).select('rect').attr('stroke', '#6366f1').attr('stroke-width', 2);
      }).on('mouseleave', function() {
        d3.select(this).select('rect').attr('stroke', '#333350').attr('stroke-width', 1.5);
      });
    }
  }, [boards]);

  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
    }
  };

  const handleFitView = () => {
    if (!svgRef.current || !containerRef.current || !zoomRef.current || !boards.length) return;
    const container = containerRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const gap = 60;
    const cols = Math.max(1, Math.floor(Math.sqrt(boards.length)));
    const totalWidth = cols * (NODE_WIDTH + gap) + gap;
    const totalRows = Math.ceil(boards.length / cols);
    const totalHeight = totalRows * (220 + gap) + gap;
    const scaleX = width / totalWidth;
    const scaleY = height / totalHeight;
    const scale = Math.min(scaleX, scaleY, 1) * 0.9;
    const tx = (width - totalWidth * scale) / 2;
    const ty = (height - totalHeight * scale) / 2;
    d3.select(svgRef.current).transition().duration(500)
      .call(zoomRef.current.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
          <p className="text-dark-300 mb-2">{error}</p>
          <button onClick={fetchBoards} className="px-3 py-1.5 text-sm bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-dark-700 bg-dark-900/80">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-dark-200">Processes</h2>
          <span className="text-xs text-dark-500">{boards.length} boards</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={handleZoomIn} className="p-1.5 text-dark-400 hover:text-dark-200 hover:bg-dark-700 rounded transition-colors" title="Zoom in">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button onClick={handleZoomOut} className="p-1.5 text-dark-400 hover:text-dark-200 hover:bg-dark-700 rounded transition-colors" title="Zoom out">
            <ZoomOut className="w-4 h-4" />
          </button>
          <button onClick={handleFitView} className="p-1.5 text-dark-400 hover:text-dark-200 hover:bg-dark-700 rounded transition-colors" title="Fit view">
            <Maximize2 className="w-4 h-4" />
          </button>
          <button onClick={fetchBoards} className="p-1.5 text-dark-400 hover:text-dark-200 hover:bg-dark-700 rounded transition-colors" title="Refresh">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Graph canvas */}
      <div className="flex-1 min-h-0 relative" ref={containerRef}>
        <svg ref={svgRef} className="w-full h-full" style={{ background: '#0d0d1a' }} />

        {/* Board detail panel */}
        {selectedBoard && (
          <div className="absolute top-4 right-4 w-80 max-h-[calc(100%-2rem)] overflow-auto bg-dark-800 border border-dark-700 rounded-xl shadow-2xl z-10">
            <div className="sticky top-0 flex items-center justify-between px-4 py-3 bg-dark-800 border-b border-dark-700 rounded-t-xl">
              <div>
                <h3 className="text-sm font-semibold text-dark-100">{selectedBoard.name}</h3>
                <p className="text-xs text-dark-400">
                  {selectedBoard.display_name || selectedBoard.username || 'Unknown'}
                  {selectedBoard.is_default && <span className="ml-1.5 text-indigo-400">(default)</span>}
                </p>
              </div>
              <button onClick={() => setSelectedBoard(null)} className="text-dark-400 hover:text-dark-200 text-lg leading-none">&times;</button>
            </div>
            <div className="p-4 space-y-3">
              {/* Workflow columns */}
              <div>
                <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">Workflow Steps</h4>
                <div className="space-y-1">
                  {selectedBoard.workflow?.columns?.map((col, i) => {
                    const trans = selectedBoard.workflow?.transitions?.find(t => t.from === col.id);
                    const actions = trans?.actions || [];
                    return (
                      <div key={col.id} className="flex items-start gap-2">
                        <div className="flex flex-col items-center mt-1">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: col.color || '#6b7280' }} />
                          {i < (selectedBoard.workflow?.columns?.length || 0) - 1 && (
                            <div className="w-px h-4 bg-dark-600 mt-0.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className="text-xs text-dark-200 font-medium">{col.label}</span>
                          {actions.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {actions.map((a, ai) => (
                                <span key={ai} className={`inline-block px-1.5 py-0.5 text-[9px] rounded ${
                                  a.type === 'run_agent' ? 'bg-indigo-500/15 text-indigo-400' :
                                  a.type === 'change_status' ? 'bg-yellow-500/15 text-yellow-400' :
                                  'bg-dark-600 text-dark-300'
                                }`}>
                                  {a.type === 'run_agent' ? `agent:${a.role || '?'}` :
                                   a.type === 'change_status' ? `move:${a.targetColumn || '?'}` :
                                   a.type}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Relations */}
              {(() => {
                const edges = detectRelations(boards);
                const outgoing = edges.filter(e => e.source === selectedBoard.id);
                const incoming = edges.filter(e => e.target === selectedBoard.id);
                if (!outgoing.length && !incoming.length) return null;
                return (
                  <div>
                    <h4 className="text-xs font-semibold text-dark-400 uppercase mb-2">Relations</h4>
                    <div className="space-y-1">
                      {outgoing.map((e, i) => {
                        const target = boards.find(b => b.id === e.target);
                        return (
                          <div key={`out-${i}`} className="flex items-center gap-2 text-xs">
                            <span className="text-indigo-400">&rarr;</span>
                            <span className="text-dark-300">{target?.name || 'Unknown'}</span>
                            <span className="text-dark-500">({e.label})</span>
                          </div>
                        );
                      })}
                      {incoming.map((e, i) => {
                        const source = boards.find(b => b.id === e.source);
                        return (
                          <div key={`in-${i}`} className="flex items-center gap-2 text-xs">
                            <span className="text-green-400">&larr;</span>
                            <span className="text-dark-300">{source?.name || 'Unknown'}</span>
                            <span className="text-dark-500">({e.label})</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
