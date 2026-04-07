const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());

app.get("/analyze", async (req, res) => {
  try {
    const url = req.query.url;

    const start = Date.now();

    const response = await axios.get("https://" + url);

    const time = Date.now() - start;

    const headers = response.headers;

    let cdn = "Unknown";

    if (headers["cf-ray"]) cdn = "Cloudflare";
    else if (headers["x-amz-cf-id"]) cdn = "CloudFront";
    else if ((headers["server"] || "").includes("Akamai")) cdn = "Akamai";

    res.json({
      url,
      cdn,
      status: response.status,
      loadTime: time,
      headers
    });

  } catch (err) {
    res.status(500).json({ error: "Failed to analyze" });
  }
});

app.listen(3000, () => console.log("Server running on port 3000"));
