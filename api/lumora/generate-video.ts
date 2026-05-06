import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log("LUMORA GENERATE START");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    const {
      prompt,
      aspectRatio = "9:16",
      duration = 8
    } = body || {};

    if (!prompt) {
      return res.status(400).json({ error: "Missing prompt" });
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (!token) {
      return res.status(500).json({ error: "Missing REPLICATE_API_TOKEN" });
    }

    const model =
      process.env.REPLICATE_VIDEO_MODEL || "luma/ray-2-720p";

    console.log("Using model:", model);

    const { default: Replicate } = await import("replicate");

    const replicate = new Replicate({
      auth: token
    });

    const input = {
      prompt,
      aspect_ratio: aspectRatio,
      duration
    };

    console.log("Calling Replicate...");

    const output = await replicate.run(model, { input });

    console.log("Replicate output:", output);

    let videoUrl = null;

    if (typeof output === "string") {
      videoUrl = output;
    } else if (Array.isArray(output)) {
      videoUrl = output[0];
    } else if (output?.url) {
      videoUrl = output.url;
    }

    if (!videoUrl) {
      return res.status(500).json({
        error: "No video returned",
        raw: output
      });
    }

    return res.status(200).json({
      success: true,
      videoUrl,
      provider: "replicate",
      model
    });

  } catch (err: any) {
    console.error("LUMORA GENERATE ERROR:", err);

    return res.status(500).json({
      error: "Generation failed",
      message: err?.message || "Unknown error",
      stack: err?.stack || null
    });
  }
}
