import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

const SUPABASE_URL = "https://khhxcruhhhzuuykfeivd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaHhjcnVoaGh6dXV5a2ZlaXZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2NzA3NjcsImV4cCI6MjA4OTI0Njc2N30.RoALBCT3HpNSkBGl4NsdML0H1qYwI5uqIM32jWIyBnY";

function ogTagsPlugin() {
  const cache = new Map();

  return {
    name: "og-tags-plugin",
    
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          const match = req.url.split("?")[0].match(/^\/b\/([a-z0-9-]+)$/);
          if (!match) return next();

          const slug = match[1];
          const cacheKey = `business:${slug}`;
          
          try {
            let business = cache.get(cacheKey);
            if (!business) {
              const response = await fetch(
                `${SUPABASE_URL}/rest/v1/businesses?slug=eq.${slug}&select=id,name,logo_url`,
                {
                  headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                  },
                }
              );
              const data = await response.json();
              business = data?.[0];
              
              if (business) {
                cache.set(cacheKey, business);
                setTimeout(() => cache.delete(cacheKey), 5 * 60 * 1000);
              }
            }

            if (!business) return next();

            let html = fs.readFileSync(path.resolve(__dirname, "index.html"), "utf-8");
            html = await server.transformIndexHtml(req.url, html);
            
            const ogImage = business.logo_url || "https://storage.googleapis.com/gpt-engineer-file-uploads/Duh8ikF0sAdjGOTp01HM0zVeh6s1/social-images/social-1772837223977-logo_circus_pop.webp";
            const ogTitle = `${business.name} - Menú Digital`;
            const ogDescription = `Pide tu comida en ${business.name}`;

            html = html
              .replace(/<meta property="og:image" content="[^"]*"/g, `<meta property="og:image" content="${ogImage}"`)
              .replace(/<meta property="og:title" content="[^"]*"/g, `<meta property="og:title" content="${ogTitle}"`)
              .replace(/<meta property="og:description" content="[^"]*"/g, `<meta property="og:description" content="${ogDescription}"`)
              .replace(/<meta name="twitter:image" content="[^"]*"/g, `<meta name="twitter:image" content="${ogImage}"`)
              .replace(/<meta name="twitter:title" content="[^"]*"/g, `<meta name="twitter:title" content="${ogTitle}"`)
              .replace(/<meta name="twitter:description" content="[^"]*"/g, `<meta name="twitter:description" content="${ogDescription}"`)
              .replace(/<title>[^<]*<\/title>/, `<title>${business.name} - Menú Digital</title>`);

            res.setHeader("Content-Type", "text/html");
            res.end(html);
          } catch (err) {
            console.error("OG tags middleware error:", err);
            return next();
          }
        });
      };
    },
  };
}

export default defineConfig({
  server: {
    host: "0.0.0.0",
    port: 5000,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(SUPABASE_URL),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify(SUPABASE_ANON_KEY),
  },
  plugins: [ogTagsPlugin(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@assets": path.resolve(__dirname, "./attached_assets"),
    },
  },
});
