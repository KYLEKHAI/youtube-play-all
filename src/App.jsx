import { useState, useEffect, useRef } from "react";
import {
  Copy,
  ExternalLink,
  RotateCcw,
  Sun,
  Moon,
  Github,
  X,
} from "lucide-react";
import toast, { Toaster } from "react-hot-toast";
import "./App.css";

function App() {
  const [channelInput, setChannelInput] = useState("");
  const [playlistUrl, setPlaylistUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const extractionControllerRef = useRef(null);

  // Local storage for theme
  useEffect(() => {
    const savedTheme = localStorage.getItem("youtube-play-all-theme");

    if (savedTheme) {
      setIsDarkMode(savedTheme === "dark");
    } else {
      const systemPrefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      setIsDarkMode(systemPrefersDark);
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute(
      "data-theme",
      isDarkMode ? "dark" : "light"
    );
  }, [isDarkMode]);

  useEffect(() => {
    return () => {
      extractionControllerRef.current?.abort();
    };
  }, []);

  // Light/Dark toggle
  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);

    // Save user preference
    localStorage.setItem("youtube-play-all-theme", newTheme ? "dark" : "light");

    toast.success(`Switched to ${newTheme ? "dark" : "light"} mode`);
  };

  const parseChannelInput = (input) => {
    const cleanInput = input.trim();
    console.log(`Parsing input: "${cleanInput}"`);

    // Direct channel ID (using UC as prefix)
    const directChannelMatch = cleanInput.match(/^UC[a-zA-Z0-9_-]{22}$/);
    if (directChannelMatch) {
      console.log("Detected: Direct channel ID");
      return { type: "channelId", value: cleanInput };
    }

    // Channel URL with ID
    const channelUrlMatch = cleanInput.match(
      /(?:youtube\.com\/channel\/)(UC[a-zA-Z0-9_-]{22})/
    );
    if (channelUrlMatch) {
      console.log("Detected: Channel URL with ID");
      return { type: "channelId", value: channelUrlMatch[1] };
    }

    // @username format
    const usernameMatch = cleanInput.match(
      /(?:youtube\.com\/|^)@([a-zA-Z0-9_.-]+)/
    );
    if (usernameMatch) {
      console.log(`Detected: @username format (${usernameMatch[1]})`);
      return { type: "username", value: usernameMatch[1] };
    }

    // Bare username/handle format
    const bareUsernameMatch = cleanInput.match(/^[a-zA-Z0-9_.-]+$/);
    if (bareUsernameMatch) {
      console.log(`Detected: bare username format (${cleanInput})`);
      return { type: "username", value: cleanInput };
    }

    // Custom URL (/c/ format)
    const customUrlMatch = cleanInput.match(
      /youtube\.com\/c\/([a-zA-Z0-9_-]+)/
    );
    if (customUrlMatch) {
      console.log("Detected: Custom URL (/c/ format)");
      return { type: "customUrl", value: cleanInput };
    }

    // Legacy user URL
    const userUrlMatch = cleanInput.match(
      /youtube\.com\/user\/([a-zA-Z0-9_-]+)/
    );
    if (userUrlMatch) {
      console.log("Detected: Legacy user URL");
      return { type: "userUrl", value: cleanInput };
    }

    // Youtube URL's that redirect to channel homepage
    if (cleanInput.includes("youtube.com/") && !cleanInput.includes("/watch")) {
      console.log("Detected: Generic YouTube URL");
      return { type: "anyUrl", value: cleanInput };
    }

    console.log("No recognized format detected");
    return null;
  };

  // Extract channel ID from YouTube page using CORS proxy
  const extractChannelIdFromPage = async (url, signal) => {
    try {
      const corsProxies = [
        `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
        `https://corsproxy.io/?${encodeURIComponent(url)}`,
        `https://cors-anywhere.herokuapp.com/${url}`,
      ];

      let html = null;
      let lastError = null;

      for (const proxyUrl of corsProxies) {
        try {
          console.log(`Trying proxy: ${proxyUrl}`);
          const response = await fetch(proxyUrl, { signal });

          if (proxyUrl.includes("allorigins")) {
            const data = await response.json();
            if (data.contents) {
              html = data.contents;
              break;
            }
          } else {
            html = await response.text();
            if (html && html.length > 1000) {
              break;
            }
          }
        } catch (error) {
          console.log(`Proxy failed: ${proxyUrl}`, error);
          lastError = error;
          continue;
        }
      }

      if (!html) {
        throw new Error(
          `All CORS proxies failed. Last error: ${lastError?.message}`
        );
      }

      console.log(`HTML length: ${html.length}`);
      console.log(`HTML sample: ${html.substring(0, 500)}`);

      // Extraction methods
      const extractionMethods = [
        // Method 1: Look for channel ID in meta tags
        () => {
          const patterns = [
            /<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/,
            /<meta name="channelId" content="(UC[a-zA-Z0-9_-]{22})"/,
            /<meta property="al:web:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/,
          ];

          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
          }
          return null;
        },

        // Method 2: Look for channel ID in the link
        () => {
          const match = html.match(
            /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/
          );
          return match ? match[1] : null;
        },

        // Method 3: Look for channel ID in JS data
        () => {
          const patterns = [
            /"channelId":"(UC[a-zA-Z0-9_-]{22})"/,
            /"externalId":"(UC[a-zA-Z0-9_-]{22})"/,
            /"browse_endpoint_context_params":"channel_id=(UC[a-zA-Z0-9_-]{22})"/,
            /channel\/(UC[a-zA-Z0-9_-]{22})/g,
          ];

          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match) return match[1];
          }
          return null;
        },

        // Method 4: Look for @handle to channel ID mapping
        () => {
          const handleMatch = html.match(
            /"webCommandMetadata":{"url":"\/channel\/(UC[a-zA-Z0-9_-]{22})"/
          );
          if (handleMatch) return handleMatch[1];

          const browseMatch = html.match(
            /"browseEndpoint":{"browseId":"(UC[a-zA-Z0-9_-]{22})"/
          );
          if (browseMatch) return browseMatch[1];

          return null;
        },

        // Method 5: Look for ytInitialData
        () => {
          const ytDataMatch = html.match(/var ytInitialData = ({.*?});/);
          if (ytDataMatch) {
            try {
              const data = JSON.parse(ytDataMatch[1]);
              const metadata = data?.metadata?.channelMetadataRenderer;
              if (metadata?.externalId) {
                return metadata.externalId;
              }
            } catch (e) {
              console.log("Failed to parse ytInitialData:", e);
            }
          }
          return null;
        },
      ];

      // Try all extraction methods
      for (let i = 0; i < extractionMethods.length; i++) {
        try {
          const result = extractionMethods[i]();
          if (result) {
            console.log(`Extraction method ${i + 1} succeeded: ${result}`);
            return result;
          }
        } catch (error) {
          console.log(`Extraction method ${i + 1} failed:`, error);
        }
      }

      throw new Error(
        "Could not find channel ID in page content using any method"
      );
    } catch (error) {
      console.error("Full extraction error:", error);
      throw new Error(`Failed to extract channel ID: ${error.message}`);
    }
  };

  const resolveChannelIdViaApi = async (type, value, signal) => {
    const params = new URLSearchParams({ type, value });
    const response = await fetch(`/api/resolve-channel?${params.toString()}`, {
      signal,
    });
    let data = null;

    try {
      data = await response.json();
    } catch {
      // Vite dev serves index.html for unknown routes, so fall back locally.
    }

    if (!response.ok) {
      throw new Error(data?.error || "Channel resolver API is unavailable");
    }

    if (!data?.channelId) {
      throw new Error("Channel resolver API did not return a channel ID");
    }

    console.log(`API resolver succeeded via ${data.method}: ${data.channelId}`);
    return data.channelId;
  };

  // Get the channel ID
  const resolveChannelId = async (type, value, signal) => {
    if (type === "channelId") {
      return value;
    }

    try {
      return await resolveChannelIdViaApi(type, value, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      console.log(`API resolver failed, using browser fallback: ${error.message}`);
    }

    // @username extraction
    if (type === "username") {
      try {
        const username = value.includes("@") ? value.split("@")[1] : value;

        // Direct URL format
        const directUrl = `https://www.youtube.com/@${username}`;
        console.log(`Trying direct @username approach: ${directUrl}`);

        const channelId = await extractChannelIdFromPage(directUrl, signal);
        return channelId;
      } catch (error) {
        if (signal?.aborted) throw error;
        console.log(`Direct @username approach failed: ${error.message}`);

        // Backup methods to find channel ID
        const username = value.includes("@") ? value.split("@")[1] : value;
        const altUrls = [
          `https://www.youtube.com/c/${username}`,
          `https://www.youtube.com/user/${username}`,
          `https://www.youtube.com/${username}`,
        ];

        for (const altUrl of altUrls) {
          try {
            console.log(`Trying alternative URL: ${altUrl}`);
            const channelId = await extractChannelIdFromPage(altUrl, signal);
            return channelId;
          } catch (e) {
            if (signal?.aborted) throw e;
            console.log(`Alternative URL failed: ${altUrl}`, e.message);
            continue;
          }
        }

        throw new Error(
          `Could not resolve @${username}. Please try using the direct channel URL instead.`
        );
      }
    }

    // Extract from page
    try {
      let urlToFetch = value;

      if (!urlToFetch.startsWith("http")) {
        urlToFetch = `https://${urlToFetch}`;
      }

      console.log(`Attempting to extract from: ${urlToFetch}`);
      const channelId = await extractChannelIdFromPage(urlToFetch, signal);
      return channelId;
    } catch (error) {
      if (signal?.aborted) throw error;
      console.log(`URL extraction failed for ${value}:`, error.message);
      throw new Error(
        `Could not resolve channel ID from ${value}. Please try using a direct channel URL (youtube.com/channel/UC...) or channel ID.`
      );
    }
  };

  // Channle ID to playlist conversion
  const channelIdToPlaylistId = (channelId) => {
    if (channelId && channelId.startsWith("UC")) {
      return "UU" + channelId.slice(2);
    }
    return null;
  };

  // Generate playlist URL
  const generatePlaylistUrl = (channelId) => {
    const playlistId = channelIdToPlaylistId(channelId);
    if (playlistId) {
      return `https://www.youtube.com/playlist?list=${playlistId}`;
    }
    return null;
  };

  // Gnerate playlist button
  const handleGenerate = async () => {
    if (isLoading) {
      return;
    }

    if (!channelInput.trim()) {
      toast.error(
        "Please enter a YouTube channel URL, @username, or channel ID"
      );
      return;
    }

    const extractionController = new AbortController();
    extractionControllerRef.current = extractionController;
    setIsLoading(true);
    setPlaylistUrl("");

    try {
      console.log(`Input received: ${channelInput}`);
      const parsedInput = parseChannelInput(channelInput);
      console.log(`Parsed input:`, parsedInput);

      if (!parsedInput) {
        throw new Error(
          "Invalid format. Please provide a YouTube channel URL, @username, or channel ID."
        );
      }

      const channelId = await resolveChannelId(
        parsedInput.type,
        parsedInput.value,
        extractionController.signal
      );
      if (extractionController.signal.aborted) return;
      console.log(`Resolved channel ID: ${channelId}`);

      const playlist = generatePlaylistUrl(channelId);
      console.log(`Generated playlist URL: ${playlist}`);

      if (!playlist) {
        throw new Error("Could not generate playlist URL");
      }

      setPlaylistUrl(playlist);
      toast.success("Playlist URL generated successfully!");
    } catch (error) {
      if (extractionController.signal.aborted) {
        console.log("Extraction cancelled");
        return;
      }

      console.error("Generation error:", error);
      toast.error(error.message);
      setPlaylistUrl("");
    } finally {
      if (extractionControllerRef.current === extractionController) {
        extractionControllerRef.current = null;
        setIsLoading(false);
      }
    }
  };

  const handleCancelExtraction = () => {
    extractionControllerRef.current?.abort();
    extractionControllerRef.current = null;
    setIsLoading(false);
    toast("Extraction cancelled");
  };

  // Copy URL to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(playlistUrl);
      toast.success("URL copied to clipboard!");
    } catch {
      toast.error("Failed to copy URL");
    }
  };

  // Open playlist
  const handleOpen = () => {
    window.open(playlistUrl, "_blank", "noopener,noreferrer");
    toast.success("Opening playlist in new tab!");
  };

  // Reset
  const handleReset = () => {
    setChannelInput("");
    setPlaylistUrl("");
  };

  return (
    <>
      <div className="app">
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: isDarkMode ? "#282828" : "#fff",
              color: isDarkMode ? "#fff" : "#000",
              border: `1px solid ${isDarkMode ? "#404040" : "#e0e0e0"}`,
            },
          }}
        />

        <div className="container">
          <header className="header">
            <div className="header-top">
              <div className="logo">
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <circle cx="16" cy="16" r="15" fill="#FF0000" />
                  <path d="M12 10l8 6-8 6V10z" fill="#FFFFFF" />
                  <rect
                    x="22"
                    y="8"
                    width="6"
                    height="1.5"
                    rx="0.75"
                    fill="#FFFFFF"
                  />
                  <rect
                    x="22"
                    y="12"
                    width="4"
                    height="1.5"
                    rx="0.75"
                    fill="#FFFFFF"
                  />
                  <rect
                    x="22"
                    y="16"
                    width="6"
                    height="1.5"
                    rx="0.75"
                    fill="#FFFFFF"
                  />
                  <rect
                    x="22"
                    y="20"
                    width="4"
                    height="1.5"
                    rx="0.75"
                    fill="#FFFFFF"
                  />
                  <rect
                    x="22"
                    y="24"
                    width="5"
                    height="1.5"
                    rx="0.75"
                    fill="#FFFFFF"
                  />
                </svg>
                <h1>YouTube Play All</h1>
              </div>
              <button
                onClick={toggleTheme}
                className="theme-toggle"
                aria-label="Toggle theme"
              >
                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
              </button>
            </div>

            <p className="subtitle">
              Generate a playlist to play all videos from any YouTube channel
            </p>
          </header>

          <div className="form-section">
            <div className="input-group">
              <label htmlFor="channel-input">
                Enter Youtube Channel ID, Username or URL
              </label>
              <input
                id="channel-input"
                type="text"
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                placeholder="YouTube Channel URL, @Username, or Channel ID"
                className="url-input"
                onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
              />
            </div>

            <div className="generate-actions">
              <button
                onClick={handleGenerate}
                disabled={isLoading || !channelInput.trim()}
                className="generate-btn"
              >
                {isLoading ? "Extracting Channel ID..." : "Generate Playlist"}
              </button>

              {isLoading && (
                <button
                  onClick={handleCancelExtraction}
                  className="cancel-btn"
                  aria-label="Cancel extraction"
                >
                  <X size={18} />
                  Cancel
                </button>
              )}
            </div>
          </div>

          {playlistUrl && (
            <div className="result-section">
              <h3>Generated Playlist URL:</h3>
              <div className="url-display">
                <input
                  type="text"
                  value={playlistUrl}
                  readOnly
                  className="result-input"
                />
              </div>

              <div className="action-buttons">
                <button onClick={handleOpen} className="open-btn">
                  <ExternalLink size={16} />
                  Open Playlist
                </button>

                <button onClick={handleCopy} className="copy-btn">
                  <Copy size={16} />
                  Copy URL
                </button>

                <button onClick={handleReset} className="reset-btn">
                  <RotateCcw size={16} />
                  Reset
                </button>
              </div>
            </div>
          )}

          <footer className="footer">
            <div className="how-to-find">
              <h4>Examples of accepted formats:</h4>
              <ul>
                <li>
                  <strong>Username:</strong> jawed or @jawed
                </li>
                <li>
                  <strong>Channel URL:</strong> https://www.youtube.com/@jawed
                </li>
                <li>
                  <strong>Channel ID:</strong> UC4QobU6STFB0P71PMvOGN5A
                </li>
              </ul>
              <p>
                <strong>How it works:</strong> The app automatically extracts
                the channel ID from any YouTube channel page and generates a
                playlist of all uploaded videos. This provides an automatic
                approach to the method described in{" "}
                <a
                  href="https://www.reddit.com/r/LifeProTips/comments/247c2u/lpt_youtube_how_to_play_all_videos_from_a_channel/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="reddit-link"
                >
                  this reddit post
                </a>
              </p>
            </div>
          </footer>
        </div>

        <a
          href="https://github.com/KYLEKHAI/youtube-play-all"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          title="View on GitHub"
        >
          <Github size={28} />
        </a>
      </div>
    </>
  );
}

export default App;
