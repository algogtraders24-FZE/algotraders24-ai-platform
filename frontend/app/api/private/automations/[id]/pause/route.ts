// app/api/private/automations/[id]/pause/route.ts - AT24 Automation lifecycle.
import { lifecycleRoute } from "@/services/automation/route-helpers";
export const POST = lifecycleRoute("pause");
