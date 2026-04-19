import { serve } from "bun";
import index from "./index.html";
import { join }   from "path";

const server = serve({
  port: process.env.APP_PORT,
  routes: {

    // ── Static files from the dummy/ folder ───────────────────────
        // Must be declared before the "/*" catch-all or it will never match.
        // Bun.file() resolves relative to the project root (where bun.lock lives).
        //
        // Supported files: *.tif, *.geojson, *.json, *.png, etc.
        // Add more glob patterns here if needed.
    "/dummy/:file": (req) => {
        const file    = req.params.file;
        const safeName = file.replace(/[^a-zA-Z0-9._-]/g, ""); // strip path traversal
        const filePath = join(process.cwd(), "dummy", safeName);
        const bunFile = Bun.file(filePath);
        return new Response(bunFile, {
            headers: {
                // GeoTIFF MIME type — geotiff.js requires this for range requests
                "Content-Type": filePath.endsWith(".tif") || filePath.endsWith(".tiff")
                    ? "image/tiff"
                    : filePath.endsWith(".geojson") || filePath.endsWith(".json")
                    ? "application/json"
                    : "application/octet-stream",
                // Allow geotiff.js to make partial-content (range) requests
                // for large Cloud-Optimized GeoTIFFs
                "Accept-Ranges": "bytes",
            },
        });
    },

    // Serve index.html for all unmatched routes.
    "/*": index,


    "/api/hello": {
      async GET(req) {
        return Response.json({
          message: "Hello, world!",
          method: "GET",
        });
      },
      async PUT(req) {
        return Response.json({
          message: "Hello, world!",
          method: "PUT",
        });
      },
    },

    "/api/hello/:name": async req => {
      const name = req.params.name;
      return Response.json({
        message: `Hello, ${name}!`,
      });
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
