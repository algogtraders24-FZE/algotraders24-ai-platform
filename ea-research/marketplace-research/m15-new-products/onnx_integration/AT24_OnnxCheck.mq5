//+------------------------------------------------------------------+
//| AT24_OnnxCheck.mq5 (TEST TOOL) - loads each ONNX model both from  |
//| MQL5\Files (original two-file form) and from the model embedded   |
//| in this program (single-file form), runs fixed feature vectors    |
//| and writes the scores to Common\Files\AT24_ONNX_CHECK.txt         |
//+------------------------------------------------------------------+
#property script_show_inputs
#resource "xxxus30_filter_embedded.onnx" as uchar US30Model[]
#resource "xxxbtc_filter_embedded.onnx" as uchar BTCModel[]

string g_out = "";

void Say(const string s) { Print(s); g_out += s + "\n"; }

void Run(const string tag, const long h)
  {
   if(h == INVALID_HANDLE) { Say(tag + ": LOAD FAILED err " + IntegerToString(GetLastError())); return; }
   long in_shape[2]  = {1, 5};
   long out_shape[2] = {1, 1};
   bool a = OnnxSetInputShape(h, 0, in_shape);
   bool b = OnnxSetOutputShape(h, 0, out_shape);
   float X[4][5] = {{0.55f, 0.0012f, 0.8f, 1.2f, 1.0f}, {0.45f, 0.0009f, -1.1f, 0.4f, -1.0f}, {0.70f, 0.002f, 2.0f, 0.1f, 1.0f}, {0.30f, 0.0005f, -0.3f, 3.0f, -1.0f}};
   string r = "";
   for(int i = 0; i < 4; i++)
     {
      float in[5], out[1];
      for(int k = 0; k < 5; k++) in[k] = X[i][k];
      if(!OnnxRun(h, ONNX_NO_CONVERSION, in, out)) { r += " RUNFAIL(" + IntegerToString(GetLastError()) + ")"; continue; }
      r += " " + DoubleToString(out[0], 6);
     }
   Say(tag + ": loaded, shapes set " + (string)(a && b) + " | scores:" + r);
   OnnxRelease(h);
  }

void OnStart()
  {
   Say("terminal build " + IntegerToString((int)TerminalInfoInteger(TERMINAL_BUILD)));
   Run("US30 from FILE    ", OnnxCreate("xxxus30_filter.onnx", ONNX_DEFAULT));
   Run("US30 from RESOURCE", OnnxCreateFromBuffer(US30Model, ONNX_DEFAULT));
   Run("BTC  from FILE    ", OnnxCreate("xxxbtc_filter.onnx", ONNX_DEFAULT));
   Run("BTC  from RESOURCE", OnnxCreateFromBuffer(BTCModel, ONNX_DEFAULT));
   int f = FileOpen("AT24_ONNX_CHECK.txt", FILE_WRITE | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(f != INVALID_HANDLE) { FileWriteString(f, g_out); FileClose(f); }
  }
