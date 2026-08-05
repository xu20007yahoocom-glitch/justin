---
*** Begin Patch
*** Update File: lib/simulatedAnalysis.ts
@@
-  const movingAverageNote =
-    technicals.smaShort !== null && technicals.smaLong !== null
-      ? `短期均線（${technicals.smaShortPeriod}期）約為 ${technicals.smaShort}，長期均線（${technicals.smaLongPeriod}期）約為 ${technicals.smaLong}，均線排列呈${trendLabe[...]
-      : "歷史資料點不足，暫無法計算穩定的均線關係。";
+  const movingAverageNote =
+    technicals.smaShort !== null && technicals.smaLong !== null
+      ? `短期均線（${technicals.smaShortPeriod}期）約為 ${technicals.smaShort}，長期均線（${technicals.smaLongPeriod}期）約為 ${technicals.smaLong}，均線排列呈${trendLabel(
+          technicals.trend
+        )}。`
+      : "歷史資料點不足，暫無法計算穩定的均線關係。";
*** End Patch
