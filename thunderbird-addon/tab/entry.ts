// Single entry point for tab/index.html. Import order matters: api-shim's
// module body runs to completion (synchronously assigning window.api)
// before main.tsx's module body runs, because ES module imports are
// evaluated in order -- so App.tsx's useEffect calls into window.api.* are
// guaranteed to see it already defined, same as Electron's preload script
// running before the renderer's own scripts.
import "./api-shim";
import "../../src/main";
