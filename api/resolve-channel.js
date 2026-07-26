const CHANNEL_ID_PATTERN = /UC[a-zA-Z0-9_-]{22}/;

const json = (body, status = 200, nodeResponse = null) => {
  const cacheControl =
    status === 200 ? "s-maxage=86400, stale-while-revalidate=604800" : "no-store";

  if (nodeResponse) {
    nodeResponse.statusCode = status;
    nodeResponse.setHeader("content-type", "application/json; charset=utf-8");
    nodeResponse.setHeader("cache-control", cacheControl);
    nodeResponse.end(JSON.stringify(body));
    return undefined;
  }

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
};

const normalizeUsername = (value) =>
  value.trim().replace(/^https?:\/\/(?:www\.)?youtube\.com\/@/, "").replace(/^@/, "");

const fetchText = async (url) => {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "Mozilla/5.0 (compatible; YouTubePlayAll/1.0; +https://youtube-play-all.vercel.app)",
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7",
      "accept-language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  return response.text();
};

const extractChannelId = (text) => {
  const patterns = [
    /<yt:channelId>(UC[a-zA-Z0-9_-]{22})<\/yt:channelId>/,
    /channel_id=(UC[a-zA-Z0-9_-]{22})/,
    /youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/,
    /"channelId":"(UC[a-zA-Z0-9_-]{22})"/,
    /"externalId":"(UC[a-zA-Z0-9_-]{22})"/,
    /"browseId":"(UC[a-zA-Z0-9_-]{22})"/,
    /"browse_endpoint_context_params":"channel_id=(UC[a-zA-Z0-9_-]{22})"/,
    /<meta name="channelId" content="(UC[a-zA-Z0-9_-]{22})"/,
    /<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/,
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }

  const genericMatch = text.match(CHANNEL_ID_PATTERN);
  return genericMatch?.[0] ?? null;
};

const resolveFromUserFeed = async (username) => {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?user=${encodeURIComponent(
    username
  )}`;
  const xml = await fetchText(feedUrl);
  return extractChannelId(xml);
};

const resolveFromPage = async (url) => {
  const html = await fetchText(url);
  return extractChannelId(html);
};

const resolveChannelId = async (type, value) => {
  const cleanValue = value.trim();

  if (type === "channelId") {
    return { channelId: cleanValue, method: "direct-channel-id" };
  }

  if (type === "username") {
    const username = normalizeUsername(cleanValue);

    try {
      const channelId = await resolveFromUserFeed(username);
      if (channelId) return { channelId, method: "youtube-user-feed" };
    } catch {
      // Some handles do not have a legacy/user feed. Fall through to page lookup.
    }

    const urls = [
      `https://www.youtube.com/@${username}`,
      `https://www.youtube.com/c/${username}`,
      `https://www.youtube.com/user/${username}`,
      `https://www.youtube.com/${username}`,
    ];

    for (const url of urls) {
      try {
        const channelId = await resolveFromPage(url);
        if (channelId) return { channelId, method: "youtube-page" };
      } catch {
        // Try the next known YouTube URL shape.
      }
    }
  }

  let url = cleanValue;
  if (!url.startsWith("http")) {
    url = `https://${url}`;
  }

  const channelId = await resolveFromPage(url);
  if (channelId) return { channelId, method: "youtube-page" };

  throw new Error("Could not find a channel ID for that input.");
};

const getRequestUrl = (request) => {
  if (request.url.startsWith("http")) {
    return new URL(request.url);
  }

  const host = request.headers?.host || "localhost";
  return new URL(request.url, `https://${host}`);
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405, response);
  }

  const url = getRequestUrl(request);
  const type = url.searchParams.get("type");
  const value = url.searchParams.get("value");

  if (!type || !value) {
    return json({ error: "Missing type or value." }, 400, response);
  }

  try {
    const result = await resolveChannelId(type, value);
    return json(result, 200, response);
  } catch (error) {
    return json({ error: error.message }, 404, response);
  }
}
