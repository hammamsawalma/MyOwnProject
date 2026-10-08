import type { MetadataRoute } from "next";
import { ADMIN_PREFIX, CLIENT_PORTAL_PREFIX } from "@/config/routes";

export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: [`${CLIENT_PORTAL_PREFIX}/`, ADMIN_PREFIX] }] };
}
