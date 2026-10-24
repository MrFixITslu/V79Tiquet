import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));
const workspace=fileURLToPath(new URL("../../",import.meta.url));
const outDir=fileURLToPath(new URL("../../.support-ui-build/",import.meta.url));
// This is an isolated, local dev/test app, not the main Tiquet SPA.
export default defineConfig({
 root,plugins:[react()],
 server:{host:"127.0.0.1",port:4308,strictPort:true,fs:{allow:[workspace]},
  proxy:{"/api":{target:"http://127.0.0.1:3088",changeOrigin:false}}},
 preview:{host:"127.0.0.1",port:4309,strictPort:true},
 build:{outDir,emptyOutDir:true},
});
