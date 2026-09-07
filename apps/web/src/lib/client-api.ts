"use client";

import { createKathaClient } from "@katha/api-client";
import { API_URL } from "./api";
import { tokenStore } from "./token-store";

/** Browser client: attaches the bearer token and refreshes once on 401. */
export const clientApi = createKathaClient({ baseUrl: API_URL, platform: "web", tokens: tokenStore });
