import re
L = r"E:\algotraders24-ai-platform\ea-research\lab\FreeIndicators"
O = L + r"\AT24_LicensedUtilityEAs_v1"

def load(p): return open(p, encoding="utf-8").read().replace("\r\n", "\n")

def common(t, pid, name, ver, oldver):
    def s(a, b):
        nonlocal t
        assert t.count(a) == 1, a[:70]
        t = t.replace(a, b)
    s("#property indicator_chart_window\n", "")
    s("#property indicator_plots 0\n", "")
    s('#property version   "%s"' % oldver, '#property version   "%s"' % ver)
    s('#include <Canvas/Canvas.mqh>\n', '#include <Canvas/Canvas.mqh>\n\n#define AT24_PRODUCT_ID "%s"\n#include "AT24_LicenseGate.mqh"\n' % pid)
    s('input group "=== ', 'input group "=== LICENCE ==="\ninput string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)\n\ninput group "=== ', ) if False else None
    # licence input goes in front of the first input group
    i = t.index('input group "=== ')
    t = t[:i] + 'input group "=== LICENCE ==="\ninput string InpLicenseKey = "";   // Licence key from your AT24 purchase page (Dashboard > Purchases)\n\n' + t[i:]
    t = t.replace('#property description "Education tool, not a signal.', '#property description "Licensed utility EA: draws and shows context only, it never places orders."\n#property description "Education tool, not a signal.', 1)
    return t

# ---------------- Pivot Levels Map ----------------
t = load(L + r"\AT24_PivotLevelsMap_v1.01\AT24_PivotLevelsMap.mq5")
t = common(t, "AT24-PIVOT-LEVELS-MAP", "Pivot Levels Map", "1.02", "1.01")
a = t.index("int OnInit()")
t = t[:a] + '''int OnInit()
{
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   g_dayStart = 0;
   g_lastUpdate = 0;
   g_snapDone = false;
   g_initTime = TimeLocal();
   DashCreate();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) { g_cv.Destroy(); g_dashOn = false; }
   DeleteAll();
   Comment("");
}

void Stopped()
{
   // licence refused later on (revoked / moved to another account): clear the chart, the gate shows the reason
   DeleteAll();
   if(g_dashOn) { g_cv.Erase(0); g_cv.Update(); }
}

void Update()
{
   if(!AT24Gate_Allowed()) { Stopped(); return; }
   if(Bars(_Symbol, _Period) < 2) return;

   datetime lastBar = iTime(_Symbol, _Period, 0);
   datetime day = iTime(_Symbol, PERIOD_D1, 0);
   if(lastBar == 0 || day == 0) return;

   if(g_incomplete && GetTickCount() >= g_retryAt) { g_retryAt = GetTickCount() + 3000; g_dayStart = 0; }
   if(day != g_dayStart || g_n == 0)
   {
      BuildLevels();
      if(g_n == 0) return;
      DrawLevels(lastBar);
      g_dayStart = day;
   }
   else if(lastBar != g_lastUpdate)
   {
      MoveLabels(lastBar);
   }
   g_lastUpdate = lastBar;
   DrawDash();
}

void OnTimer()
{
   AT24Gate_Timer(InpLicenseKey);
   Update();
   if(InpSaveSnapshot && !g_snapDone && g_n > 0 && TimeLocal() - g_initTime >= 4)
   {
      g_snapDone = true;
      string fn = "AT24_PivotLevelsMap_snapshot.png";
      if(ChartScreenShot(0, fn, 1280, 720, ALIGN_RIGHT)) Print("AT24 Pivot Levels Map: snapshot saved to MQL5/Files/", fn);
   }
}

void OnTick() { Update(); }
'''
open(O + r"\AT24_PivotLevelsMap_Licensed.mq5", "w", encoding="utf-8", newline="\r\n").write(t)

# ---------------- Hourly Range Heatmap / Spread by Hour ----------------
def hourly(src, dst, pid, ver, oldver):
    t = load(src)
    t = common(t, pid, "", ver, oldver)
    a = t.index("int OnInit()")
    b = t.index("void Refresh()")
    head = t[:a]
    refresh_start = b
    c = t.index("void OnTimer()")
    refresh = t[b:c]
    t = head + '''int OnInit()
{
   if(!AT24Gate_Init(InpLicenseKey)) return INIT_FAILED;
   g_lastH1 = 0;
   DashCreate();
   EventSetTimer(1);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   if(g_dashOn) { g_cv.Destroy(); g_dashOn = false; }
   Comment("");
}

''' + refresh + '''void Step()
{
   if(!AT24Gate_Allowed())
   {
      if(g_dashOn) { g_cv.Erase(0); g_cv.Update(); }
      return;
   }
   Refresh();
   DrawDash();
}

void OnTimer()
{
   AT24Gate_Timer(InpLicenseKey);
   Step();
}

void OnTick() { Step(); }
'''
    open(dst, "w", encoding="utf-8", newline="\r\n").write(t)

hourly(L + r"\AT24_HourlyRangeHeatmap_v1.00\AT24_HourlyRangeHeatmap.mq5", O + r"\AT24_HourlyRangeHeatmap_Licensed.mq5", "AT24-HOURLY-RANGE-HEATMAP", "1.01", "1.00")
hourly(L + r"\AT24_SpreadByHour_v1.00\AT24_SpreadByHour.mq5", O + r"\AT24_SpreadByHour_Licensed.mq5", "AT24-SPREAD-BY-HOUR", "1.01", "1.00")
print("done")
