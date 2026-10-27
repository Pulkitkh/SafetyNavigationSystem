import { describe, expect, it } from "vitest";
import { normalizePhone, normalizePlate } from "@/lib/phone";
import { smsUri, sosMessage, whatsappUri } from "@/lib/sos";

describe("phone numbers", () => {
  it("normalises the ways Indian mobile numbers are typed", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("09876543210")).toBe("+919876543210");
    expect(normalizePhone("919876543210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765-43210")).toBe("+919876543210");
    expect(normalizePhone("+14155550123")).toBe("+14155550123");
  });

  it("rejects invalid numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("5876543210")).toBeNull();
    expect(normalizePhone("+911234567890")).toBeNull();
  });
});

describe("number plates", () => {
  it("accepts state and Bharat-series plates", () => {
    expect(normalizePlate("mp 09 ab 1234")).toBe("MP09AB1234");
    expect(normalizePlate("DL-3C-AB-1234")).toBe("DL3CAB1234");
    expect(normalizePlate("22 BH 1234 AA")).toBe("22BH1234AA");
  });
  it("rejects nonsense", () => {
    expect(normalizePlate("hello")).toBeNull();
    expect(normalizePlate("1234")).toBeNull();
  });
});

describe("SOS messages", () => {
  it("includes a map link that works without our server, and the live link", () => {
    const msg = sosMessage({ name: "Asha", lat: 22.7196, lng: 75.8577, accuracyM: 12, liveUrl: "https://x.test/t/abc" });
    expect(msg).toContain("SOS: Asha needs help.");
    expect(msg).toContain("https://maps.google.com/?q=22.719600,75.857700");
    expect(msg).toContain("±12m");
    expect(msg).toContain("https://x.test/t/abc");
    expect(msg).toContain("112");
  });

  it("builds platform-specific SMS links", () => {
    expect(smsUri(["+911", "+912"], "hi there", "android")).toBe("sms:+911,+912?body=hi%20there");
    expect(smsUri(["+911", "+912"], "hi", "ios")).toBe("sms://open?addresses=+911,+912&body=hi");
    expect(smsUri(["+911"], "hi", "ios")).toBe("sms:+911&body=hi");
    expect(whatsappUri("+91 98765 43210", "a b")).toBe("https://wa.me/919876543210?text=a%20b");
  });
});
