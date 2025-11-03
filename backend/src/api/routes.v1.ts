// backend/src/api/routes.v1.ts
// Legacy compatibility entrypoint that re-exports the modular router.
// Ensures older tests continue to resolve the same route stack.
import api from "./routes";

export default api;
