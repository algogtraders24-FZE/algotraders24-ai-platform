// app/api/private/automations/[id]/resume/route.ts - AT24 Automation lifecycle.
import { lifecycleRoute } from "@/services/automation/route-helpers";
export const POST = lifecycleRoute("resume");
