import { defineConfig } from "deepsec/config";

export default defineConfig({
  projects: [
    { id: "agent-ml", root: ".." },
    // <deepsec:projects-insert-above>
  ],
});
