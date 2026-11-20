function browserName(userAgent: string): string {
  if (/SamsungBrowser\//i.test(userAgent)) return "Samsung Internet";
  if (/Edg\//i.test(userAgent)) return "Edge";
  if (/(?:CriOS|Chrome)\//i.test(userAgent)) return "Chrome";
  if (/(?:FxiOS|Firefox)\//i.test(userAgent)) return "Firefox";
  if (/Safari\//i.test(userAgent)) return "Safari";
  return "Browser";
}

function modelName(value: string): string {
  const model = value
    .trim()
    .replace(/^"|"$/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .slice(0, 64);
  if (/^SM-A055[A-Z0-9]*$/i.test(model)) return "Samsung Galaxy A05";
  if (/^SM-A057[A-Z0-9]*$/i.test(model)) return "Samsung Galaxy A05s";
  if (/^SM-/i.test(model)) return `Samsung ${model}`;
  if (/^Pixel\b/i.test(model)) return `Google ${model}`;
  return model;
}

export function identifyDevice(userAgent: string | null, modelHint: string | null): string {
  const ua = userAgent || "";
  const browser = browserName(ua);
  const hint = modelHint?.trim();
  const hintedModel = hint && hint !== '""' ? modelName(hint) : "";
  const uaModel =
    /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]+)?\s*[;)]/i.exec(ua)?.[1]?.trim() || "";
  const androidModel =
    uaModel && !/^(?:K|mobile|wv|arm|x86|unknown)$/i.test(uaModel) ? modelName(uaModel) : "";
  const model = hintedModel || androidModel;

  if (model) return `${model} (${browser})`;
  if (/iPhone/i.test(ua)) return `iPhone (${browser})`;
  if (/iPad/i.test(ua)) return `iPad (${browser})`;
  if (/Android/i.test(ua))
    return `${/SamsungBrowser|SM-/i.test(ua) ? "Samsung Android device" : "Android device"} (${browser})`;
  if (/Windows/i.test(ua)) return `Windows PC (${browser})`;
  if (/Macintosh|Mac OS X/i.test(ua)) return `Mac (${browser})`;
  if (/Linux/i.test(ua)) return `Linux device (${browser})`;
  return `Unknown device (${browser})`;
}
