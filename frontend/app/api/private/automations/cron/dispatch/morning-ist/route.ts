// app/api/private/automations/cron/dispatch/morning-ist/route.ts
// AT24 Automation (MVP) - the "morning_ist" slot dispatch cron. Daily Vercel Cron;
// see frontend/vercel.json + CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts.
import { slotDispatchRoute } from "@/services/automation/cron-route";

export const maxDuration = 60;

const routes = slotDispatchRoute("morning_ist");
export const GET = routes.GET;
export const POST = routes.POST;
