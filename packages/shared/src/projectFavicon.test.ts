import { describe, expect, it } from "vite-plus/test";

import {
  getProjectFaviconCacheKey,
  isProjectFaviconFallbackUrl,
  isProjectLatexFaviconUrl,
  PROJECT_FAVICON_FALLBACK_MARKER,
  PROJECT_FAVICON_LATEX_MARKER,
} from "./projectFavicon.ts";

describe("project favicon", () => {
  it("identifies LaTeX asset URLs by their dedicated filename", () => {
    expect(
      isProjectLatexFaviconUrl(
        `https://environment.example/api/assets/token/${PROJECT_FAVICON_LATEX_MARKER}?v=1`,
      ),
    ).toBe(true);
    expect(isProjectLatexFaviconUrl(`/api/assets/token/${PROJECT_FAVICON_LATEX_MARKER}`)).toBe(
      true,
    );
    expect(isProjectLatexFaviconUrl(`/api/assets/token/${PROJECT_FAVICON_FALLBACK_MARKER}`)).toBe(
      false,
    );
    expect(
      isProjectLatexFaviconUrl(
        `/api/assets/token/favicon.svg?name=${PROJECT_FAVICON_LATEX_MARKER}`,
      ),
    ).toBe(false);
    expect(
      isProjectLatexFaviconUrl(`/api/assets/token/prefix-${PROJECT_FAVICON_LATEX_MARKER}`),
    ).toBe(false);
    expect(isProjectLatexFaviconUrl(null)).toBe(false);
    expect(isProjectLatexFaviconUrl(undefined)).toBe(false);
    expect(isProjectLatexFaviconUrl("http://[")).toBe(false);
  });

  it("uses the project and versioned filename as the cache identity", () => {
    const firstUrl = "https://environment.example/api/assets/first-signed-token/v1-20-favicon.svg";
    const refreshedUrl =
      "https://environment.example/api/assets/refreshed-signed-token/v1-20-favicon.svg";

    expect(getProjectFaviconCacheKey("environment-1", "/workspace", firstUrl)).toBe(
      getProjectFaviconCacheKey("environment-1", "/workspace", refreshedUrl),
    );
    expect(getProjectFaviconCacheKey("environment-1", "/workspace", firstUrl)).not.toBe(
      getProjectFaviconCacheKey(
        "environment-1",
        "/workspace",
        "https://environment.example/api/assets/refreshed-signed-token/v2-20-favicon.svg",
      ),
    );
    expect(getProjectFaviconCacheKey("environment-1", "/workspace", firstUrl)).not.toBe(
      getProjectFaviconCacheKey("environment-2", "/workspace", firstUrl),
    );
  });

  it("identifies fallback asset URLs by their dedicated filename", () => {
    expect(
      isProjectFaviconFallbackUrl(
        `https://environment.example/api/assets/signed-token/${PROJECT_FAVICON_FALLBACK_MARKER}`,
      ),
    ).toBe(true);
    expect(
      isProjectFaviconFallbackUrl(`/api/assets/signed-token/${PROJECT_FAVICON_FALLBACK_MARKER}`),
    ).toBe(true);
  });

  it("does not mistake real favicons or query parameters for fallbacks", () => {
    expect(
      isProjectFaviconFallbackUrl("https://environment.example/api/assets/token/favicon.svg"),
    ).toBe(false);
    expect(
      isProjectFaviconFallbackUrl(
        `https://environment.example/api/assets/token/favicon.svg?name=${PROJECT_FAVICON_FALLBACK_MARKER}`,
      ),
    ).toBe(false);
    expect(isProjectFaviconFallbackUrl(null)).toBe(false);
  });
});
