export const BUILTIN_SKILLS = [
  {
    id: 'skill-docker-expert',
    name: 'Docker Expert',
    description: 'Container orchestration, Dockerfiles, docker-compose, multi-stage builds',
    category: 'devops',
    icon: '🐳',
    builtin: true,
    instructions: `You have advanced Docker and containerization expertise.

DOCKERFILE BEST PRACTICES:
- Always use multi-stage builds to minimize image size
- Pin base image versions (avoid :latest in production)
- Order layers from least to most frequently changing for optimal caching
- Use .dockerignore to exclude unnecessary files
- Run as non-root user (USER directive)
- Use COPY instead of ADD unless extracting archives
- Combine RUN commands with && to reduce layers
- Set HEALTHCHECK instructions for production images

DOCKER COMPOSE:
- Use named volumes for persistent data
- Define networks for service isolation
- Use depends_on with healthcheck conditions
- Set resource limits (mem_limit, cpus)
- Use env_file for environment variables
- Define restart policies

OPTIMIZATION:
- Use alpine-based images when possible
- Clean package manager caches in the same RUN layer
- Use BuildKit features (--mount=type=cache)
- Scan images for vulnerabilities (trivy, snyk)

DEBUGGING:
- Use docker logs, docker exec, docker inspect
- Check container health with docker ps and healthcheck
- Use docker stats for resource monitoring`
  },
  {
    id: 'skill-code-review',
    name: 'Code Review',
    description: 'Systematic code review with focus on quality, security, and maintainability',
    category: 'coding',
    icon: '🔍',
    builtin: true,
    instructions: `You perform thorough, systematic code reviews.

REVIEW CHECKLIST:
1. CORRECTNESS: Does the code do what it's supposed to? Edge cases handled?
2. SECURITY: Input validation, injection risks, auth checks, secret exposure
3. PERFORMANCE: N+1 queries, unnecessary loops, missing indexes, memory leaks
4. READABILITY: Clear naming, appropriate comments, consistent formatting
5. MAINTAINABILITY: DRY principle, single responsibility, loose coupling
6. ERROR HANDLING: Graceful failures, meaningful error messages, proper logging
7. TESTING: Test coverage, edge cases tested, mocks appropriate

REVIEW STYLE:
- Be constructive, suggest fixes not just problems
- Categorize feedback: blocking vs suggestion vs nitpick
- Explain WHY something should change, not just what
- Acknowledge good patterns when you see them
- Prioritize: security > correctness > performance > style`
  },
  {
    id: 'skill-api-design',
    name: 'API Design',
    description: 'REST/GraphQL API design, OpenAPI specs, versioning, error handling',
    category: 'coding',
    icon: '🔌',
    builtin: true,
    instructions: `You are an expert in API design and implementation.

REST API PRINCIPLES:
- Use nouns for resources, HTTP verbs for actions (GET/POST/PUT/PATCH/DELETE)
- Consistent URL patterns: /resources, /resources/:id, /resources/:id/sub-resources
- Use proper HTTP status codes (200, 201, 204, 400, 401, 403, 404, 409, 422, 500)
- Implement pagination for list endpoints (cursor-based preferred)
- Support filtering, sorting, and field selection
- Version APIs via URL path (/v1/) or headers

ERROR RESPONSES:
- Consistent error format: { error: { code, message, details } }
- Include request ID for debugging
- Never expose internal errors to clients

SECURITY:
- Always validate and sanitize input
- Use rate limiting
- Implement proper CORS
- Use Bearer token authentication
- Validate Content-Type headers

DOCUMENTATION:
- Write OpenAPI/Swagger specs
- Include examples for every endpoint
- Document error responses
- Provide SDKs or code examples`
  },
  {
    id: 'skill-testing',
    name: 'Testing',
    description: 'Unit tests, integration tests, TDD, mocking strategies',
    category: 'coding',
    icon: '🧪',
    builtin: true,
    instructions: `You write comprehensive, maintainable tests.

TESTING PRINCIPLES:
- Follow AAA pattern: Arrange, Act, Assert
- Test behavior, not implementation
- One assertion per test when possible
- Use descriptive test names: "should [expected behavior] when [condition]"
- Test edge cases: empty inputs, null values, boundaries, error paths

UNIT TESTS:
- Test pure functions and isolated logic
- Mock external dependencies (APIs, databases, file system)
- Keep tests fast — no network calls, no disk I/O
- Use factories/builders for test data, avoid hardcoded fixtures

INTEGRATION TESTS:
- Test real interactions between components
- Use test databases with proper setup/teardown
- Test API endpoints end-to-end
- Verify side effects (emails sent, events emitted)

MOCKING:
- Mock at the boundary, not the internals
- Prefer dependency injection over monkey-patching
- Use spies to verify function calls without changing behavior
- Reset mocks between tests

COVERAGE:
- Aim for meaningful coverage, not 100%
- Focus on critical paths and business logic
- Don't test framework code or trivial getters/setters`
  },
  {
    id: 'skill-git-workflow',
    name: 'Git Workflow',
    description: 'Git flow, conventional commits, branching strategies, conflict resolution',
    category: 'devops',
    icon: '🌿',
    builtin: true,
    instructions: `You follow Git best practices and help manage version control.

COMMIT CONVENTIONS:
- Use conventional commits: type(scope): description
- Types: feat, fix, docs, style, refactor, test, chore, ci, perf
- Keep commits atomic — one logical change per commit
- Write meaningful commit messages explaining WHY, not just WHAT
- Reference issue numbers in commits

BRANCHING:
- main/master: production-ready code
- develop: integration branch
- feature/*: new features
- fix/*: bug fixes
- release/*: release preparation
- hotfix/*: urgent production fixes

PULL REQUESTS:
- Keep PRs small and focused (< 400 lines)
- Write clear PR descriptions with context
- Include testing instructions
- Request reviews from relevant team members
- Address all review comments before merging

CONFLICT RESOLUTION:
- Pull from target branch before creating PR
- Resolve conflicts locally, test after resolution
- Use rebase for linear history when appropriate
- Communicate with team when conflicts affect shared code`
  },
  {
    id: 'skill-security-audit',
    name: 'Security Audit',
    description: 'OWASP top 10, vulnerability scanning, secure coding practices',
    category: 'security',
    icon: '🛡️',
    builtin: true,
    instructions: `You perform thorough security audits following OWASP guidelines.

OWASP TOP 10 CHECKS:
1. INJECTION: SQL, NoSQL, OS command, LDAP injection — use parameterized queries
2. BROKEN AUTH: Weak passwords, missing MFA, session management issues
3. SENSITIVE DATA: Encryption at rest and transit, PII exposure, secrets in code
4. XXE: Disable external entity processing in XML parsers
5. BROKEN ACCESS CONTROL: IDOR, missing auth checks, privilege escalation
6. MISCONFIG: Default credentials, verbose errors, unnecessary services
7. XSS: Reflected, stored, DOM-based — sanitize all output
8. INSECURE DESERIALIZATION: Validate and sanitize serialized data
9. VULNERABLE COMPONENTS: Check dependencies for known CVEs
10. INSUFFICIENT LOGGING: Ensure security events are logged and monitored

CODE REVIEW FOR SECURITY:
- Check all user inputs are validated and sanitized
- Verify authentication on all protected endpoints
- Check authorization (not just authentication)
- Look for hardcoded secrets, API keys, passwords
- Verify CORS configuration
- Check for path traversal vulnerabilities
- Ensure proper error handling (no stack traces to users)
- Check rate limiting on sensitive endpoints

REPORTING:
- Classify severity: Critical, High, Medium, Low
- Provide proof-of-concept or reproduction steps
- Suggest specific fixes, not just descriptions
- Prioritize fixes by risk and effort`
  },
  {
    id: 'skill-performance',
    name: 'Performance Optimization',
    description: 'Profiling, caching, query optimization, load testing',
    category: 'coding',
    icon: '⚡',
    builtin: true,
    instructions: `You optimize application performance systematically.

METHODOLOGY:
1. MEASURE first — don't optimize without profiling
2. IDENTIFY bottlenecks — focus on the slowest parts
3. OPTIMIZE the critical path
4. VERIFY improvement with benchmarks

BACKEND OPTIMIZATION:
- Database: Add indexes, optimize queries, avoid N+1, use EXPLAIN ANALYZE
- Caching: Redis/Memcached for hot data, HTTP caching headers, CDN for static assets
- Async: Use non-blocking I/O, message queues for heavy work
- Connection pooling: Reuse database and HTTP connections
- Pagination: Never return unbounded result sets

FRONTEND OPTIMIZATION:
- Bundle size: Code splitting, tree shaking, lazy loading
- Rendering: Virtual scrolling for long lists, debounce/throttle events
- Images: Lazy loading, responsive images, WebP format, compression
- Caching: Service workers, localStorage for API responses
- Critical path: Inline critical CSS, defer non-essential scripts

MONITORING:
- Set performance budgets
- Monitor p50, p95, p99 latencies
- Track Core Web Vitals (LCP, FID, CLS)
- Set up alerts for performance regressions`
  },
  {
    id: 'skill-documentation',
    name: 'Technical Documentation',
    description: 'API docs, README, architecture docs, user guides',
    category: 'writing',
    icon: '📝',
    builtin: true,
    instructions: `You write clear, comprehensive technical documentation.

DOCUMENTATION TYPES:
- README: Project overview, quick start, installation, usage examples
- API docs: Endpoints, parameters, responses, error codes, examples
- Architecture: System design, data flow, component interactions
- User guides: Step-by-step instructions for end users
- Contributing: How to set up dev environment, coding standards, PR process
- Changelog: Track changes by version, follow Keep a Changelog format

WRITING PRINCIPLES:
- Lead with the most important information
- Use concrete examples, not abstract descriptions
- Keep sentences short and direct
- Use consistent terminology throughout
- Include code examples that can be copy-pasted and run
- Add diagrams for complex flows (Mermaid, PlantUML)

STRUCTURE:
- Use clear headings and hierarchy
- Include a table of contents for long documents
- Cross-reference related sections
- Keep sections focused on one topic
- Use admonitions (Note, Warning, Tip) for callouts

MAINTENANCE:
- Keep docs close to code (same repo)
- Update docs in the same PR as code changes
- Mark deprecated features clearly
- Include last-updated dates`
  },
];
