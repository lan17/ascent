import { Router, type IRouter } from "express";
import { fetchSlackFaces } from "../lib/slack";

const router: IRouter = Router();

// Proxy Slack avatar images so the browser can use them as WebGL textures
// without running into CORS / cross-origin canvas tainting.
router.get("/slack/avatar", async (req, res) => {
  const url = String(req.query["u"] ?? "");
  if (!/^https:\/\/[a-z0-9.-]*slack(?:-edge)?\.com\//i.test(url)) {
    res.status(400).json({ error: "bad url" });
    return;
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const ct = upstream.headers.get("content-type") ?? "image/jpeg";
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(buf);
  } catch (err) {
    req.log.error({ err }, "slack avatar proxy failed");
    res.status(502).json({ error: "proxy failed" });
  }
});

router.get("/slack/faces", async (req, res) => {
  try {
    const faces = await fetchSlackFaces(32);
    // Rewrite image URLs to go through our same-origin proxy so canvas
    // textures don't get tainted by cross-origin images.
    const proxied = faces.map((f) => ({
      ...f,
      image: `/api/slack/avatar?u=${encodeURIComponent(f.image)}`,
    }));
    res.json({ faces: proxied });
  } catch (err) {
    req.log.error({ err }, "slack faces failed");
    res.status(503).json({ error: "slack unavailable", faces: [] });
  }
});

export default router;
