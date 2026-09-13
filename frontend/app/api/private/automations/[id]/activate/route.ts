// app/api/private/automations/[id]/activate/route.ts - AT24 Automation lifecycle.
import { lifecycleRoute } from "@/services/automation/route-helpers";
export const POST = lifecycleRoute("activate");
