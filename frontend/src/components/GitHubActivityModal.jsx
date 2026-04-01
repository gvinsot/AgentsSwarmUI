import { useState, useEffect } from 'react';
import { X, GitCommit, Tag, ExternalLink, Loader2, AlertCircle, Clock } from 'lucide-react';
import { api } from '../api';

export default function GitHubActivityModal({ owner, repo, onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('commits');

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getGitHubActivity(owner, repo)
      .then(result => { if (!cancelled) setData(result); })
      .catch(err => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [owner, repo]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now - d;
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return 'just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-dark-900 border border-dark-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        style={{ width: '700px', maxWidth: '90vw', maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-dark-700 shrink-0">
          <div className="flex items-center gap-2">
            <GithubIcon className="w-5 h-5 text-white" />
            <h2 className="text-base font-semibold text-white">{owner}/{repo}</h2>
            <span className="text-xs text-dark-400">Activity</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`https://github.com/${owner}/${repo}`}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
              title="Open on GitHub"
            >
              <ExternalLink size={14} />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 text-dark-400 hover:text-white hover:bg-dark-700 rounded-lg transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-dark-700 shrink-0">
          <button
            onClick={() => setTab('commits')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'commits'
                ? 'text-white border-b-2 border-purple-500'
                : 'text-dark-400 hover:text-white'
            }`}
          >
            <GitCommit size={14} />
            Commits
            {data && <span className="text-xs text-dark-500 ml-1">({data.commits.length})</span>}
          </button>
          <button
            onClick={() => setTab('tags')}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'tags'
                ? 'text-white border-b-2 border-purple-500'
                : 'text-dark-400 hover:text-white'
            }`}
          >
            <Tag size={14} />
            Tags / Releases
            {data && <span className="text-xs text-dark-500 ml-1">({data.tags.length})</span>}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 size={24} className="animate-spin text-purple-400" />
              <span className="ml-2 text-dark-400">Loading activity...</span>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
              <AlertCircle size={16} className="text-red-400" />
              <span className="text-sm text-red-400">{error}</span>
            </div>
          )}

          {data && !loading && tab === 'commits' && (
            <div className="space-y-1">
              {data.commits.length === 0 ? (
                <p className="text-dark-500 text-sm text-center py-8">No commits in the last 30 days</p>
              ) : (
                data.commits.map(c => (
                  <a
                    key={c.sha}
                    href={c.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-3 p-2.5 rounded-lg hover:bg-dark-800 transition-colors group"
                  >
                    {c.authorAvatar ? (
                      <img src={c.authorAvatar} alt="" className="w-6 h-6 rounded-full mt-0.5 shrink-0" />
                    ) : (
                      <div className="w-6 h-6 rounded-full bg-dark-700 flex items-center justify-center mt-0.5 shrink-0">
                        <GitCommit size={12} className="text-dark-400" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate group-hover:text-purple-300">{c.message}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-xs text-purple-400 font-mono">{c.shortSha}</code>
                        <span className="text-xs text-dark-500">{c.author}</span>
                        <span className="text-xs text-dark-600 flex items-center gap-0.5">
                          <Clock size={10} />
                          {formatDate(c.date)}
                        </span>
                      </div>
                    </div>
                    <ExternalLink size={12} className="text-dark-600 group-hover:text-dark-400 mt-1 shrink-0" />
                  </a>
                ))
              )}
            </div>
          )}

          {data && !loading && tab === 'tags' && (
            <div className="space-y-1">
              {data.tags.length === 0 ? (
                <p className="text-dark-500 text-sm text-center py-8">No tags found</p>
              ) : (
                data.tags.map(t => (
                  <a
                    key={t.name}
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-dark-800 transition-colors group"
                  >
                    <Tag size={14} className="text-green-400 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white font-medium group-hover:text-green-300">{t.name}</p>
                      <code className="text-xs text-dark-500 font-mono">{t.shortSha}</code>
                    </div>
                    <ExternalLink size={12} className="text-dark-600 group-hover:text-dark-400 shrink-0" />
                  </a>
                ))
              )}
            </div>
          )}

          {data?.fetchedAt && (
            <p className="text-xs text-dark-600 text-right mt-3">
              Fetched {formatDate(data.fetchedAt)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GithubIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}
