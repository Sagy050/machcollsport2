import { describe, expect, it } from "vitest";
import { identifyDevice } from "./device-name";

describe("identifyDevice", () => {
  it("uses the browser's model hint to identify a Samsung Galaxy A05", () => {
    expect(
      identifyDevice(
        "Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
        '"SM-A055F"',
      ),
    ).toBe("Samsung Galaxy A05 (Chrome)");
    expect(
      identifyDevice(
        "Mozilla/5.0 (Linux; Android 13; SM-A055F Build/TQ3A) Chrome/120.0.0.0 Mobile Safari/537.36",
        null,
      ),
    ).toBe("Samsung Galaxy A05 (Chrome)");
  });

  it("recognizes iPhones without inferring their exact model", () => {
    expect(
      identifyDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1",
        null,
      ),
    ).toBe("iPhone (Safari)");
  });

  it("falls back to a general device label when the user agent hides the model", () => {
    expect(
      identifyDevice(
        "Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36",
        null,
      ),
    ).toBe("Android device (Chrome)");
  });
});
