// app/api/private/automations/cron/resume/route.ts
// AT24 Automation - the every-2-minutes safety net. Resumes automation runs that
// stopped making progress (a function killed mid-run, an interrupted deploy), so
// they finish inside the child agent's 5-minute window instead of failing hours
// later. Auth = valid CRON_SECRET or an authenticated admin; the path is listed in
// CRON_SECRET_EXEMPT_PATHS in frontend/proxy.ts and in frontend/vercel.json.
import { resumeStalledRoute } from "@/services/automation/cron-route";

export const maxDuration = 300;

const routes = resumeStalledRoute();
export const GET = routes.GET;
export const POST = routes.POST;
