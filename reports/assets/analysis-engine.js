/* Wayfair 分析引擎 · 浏览器端（Pyodide 跑真 Python）
 *
 * 设计目标：现在做「1」（浏览器算），将来做「2」（后端算）时只换一个函数体。
 * 对外只暴露一个稳定契约：
 *     await WFAnalysis.run(ybFile, { onLog }) -> {
 *        pricingCsv, tasksCsv, profilesCsv,   // 重算后的 CSV 文本，可下载
 *        taskRows, taskCount,                 // 解析后的任务，用于页面预览
 *        log
 *     }
 * 切换到后端：把 WFAnalysis.backend 设为 'api'，实现 _runApi（POST /api/analyze），
 * 返回同样的结构即可——上传中心页面无需任何改动。
 */
(function () {
  const PYODIDE_CDN = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";
  // 跑分析需要的真 Python（单一来源：部署的 /scripts，不复制）
  const SCRIPTS = [
    "build_product_pricing_health.py",
    "build_ops_workbench.py",
    "input_checks.py",
  ];
  // 随页面附带的基准输入（.csv.txt 规避 *.csv 部署忽略）
  const BASELINES = {
    "data/Wayfair_Pricing_ProductCatalog_定价体检_20260604.csv": "./assets/baseline/pricing_catalog.csv.txt",
    "data/Wayfair_SKU价值分级_补齐版_20260604.csv": "./assets/baseline/sku_score.csv.txt",
    "data/Wayfair_库存映射对照_20260604.csv": "./assets/baseline/inventory_map.csv.txt",
  };
  // 用户上传的 YB 工具表写到脚本期望的发现路径
  const YB_TARGET = "data/raw/Wayfair YB-工具表 2026年 06月.xlsx";
  // 重算后要回收的产物
  const OUTPUTS = {
    pricingCsv: "data/Wayfair_产品定价体检表_20260605.csv",
    tasksCsv: "data/Wayfair_运营任务清单_20260605.csv",
    profilesCsv: "data/Wayfair_SKU经营档案_20260605.csv",
  };

  let pyodidePromise = null;

  function loadPyodideRuntime(onLog) {
    if (pyodidePromise) return pyodidePromise;
    pyodidePromise = (async () => {
      onLog("加载分析运行时（首次约 30–60 秒，之后浏览器缓存）…");
      await new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = PYODIDE_CDN + "pyodide.js";
        s.onload = resolve;
        s.onerror = () => reject(new Error("无法加载 Pyodide 运行时（检查网络/CDN 可达性）"));
        document.head.appendChild(s);
      });
      const py = await loadPyodide({ indexURL: PYODIDE_CDN });
      onLog("加载 pandas / openpyxl…");
      await py.loadPackage(["pandas", "openpyxl"]);
      return py;
    })();
    return pyodidePromise;
  }

  async function fetchText(url) {
    const r = await fetch(url, { cache: "no-cache" });
    if (!r.ok) throw new Error(`取资源失败 ${url}（${r.status}）`);
    return r.text();
  }

  const WFAnalysis = {
    backend: "pyodide", // ← 改成 "api" 即切换到后端，契约不变

    async run(ybFile, opts = {}) {
      const onLog = opts.onLog || (() => {});
      if (this.backend === "api") return this._runApi(ybFile, onLog);
      return this._runPyodide(ybFile, onLog);
    },

    // ── 选 2 占位：后端就绪后实现，返回与 _runPyodide 完全相同的结构 ──
    async _runApi(ybFile, onLog) {
      onLog("提交到后端分析服务…");
      const form = new FormData();
      form.append("yb_tool", ybFile, ybFile.name);
      const r = await fetch("/api/analyze", { method: "POST", body: form });
      if (!r.ok) throw new Error(`后端分析失败（${r.status}）`);
      return r.json(); // 约定后端返回 { pricingCsv, tasksCsv, profilesCsv, taskRows, taskCount, log }
    },

    async _runPyodide(ybFile, onLog) {
      const py = await loadPyodideRuntime(onLog);

      onLog("准备工作目录…");
      py.runPython(`
import os, pathlib
for d in ["/repo/scripts", "/repo/data/raw", "/repo/reports/assets"]:
    pathlib.Path(d).mkdir(parents=True, exist_ok=True)
`);

      // 1) 写入真 Python 脚本（来自部署的 /scripts，单一来源）
      onLog("拉取分析脚本…");
      for (const name of SCRIPTS) {
        const code = await fetchText(`../scripts/${name}`);
        py.FS.writeFile(`/repo/scripts/${name}`, code);
      }

      // 2) 写入基准输入
      onLog("拉取基准数据…");
      for (const [target, url] of Object.entries(BASELINES)) {
        const text = await fetchText(url);
        py.FS.writeFile(`/repo/${target}`, text);
      }

      // 3) 写入用户上传的 YB 工具表
      onLog(`读取上传文件：${ybFile.name}…`);
      const buf = new Uint8Array(await ybFile.arrayBuffer());
      py.FS.writeFile(`/repo/${YB_TARGET}`, buf);

      // 4) 依次跑真分析：定价体检 → 任务/档案
      onLog("运行定价体检分析…");
      await this._runScript(py, "build_product_pricing_health.py", onLog);
      onLog("运行任务与经营档案分析…");
      await this._runScript(py, "build_ops_workbench.py", onLog);

      // 5) 回收产物
      onLog("收集重算结果…");
      const out = {};
      for (const [key, path] of Object.entries(OUTPUTS)) {
        try {
          out[key] = py.FS.readFile(`/repo/${path}`, { encoding: "utf8" });
        } catch (e) {
          out[key] = "";
          onLog(`（提示：未生成 ${path}）`);
        }
      }
      const parsed = parseTasks(out.tasksCsv);
      onLog(`完成：共 ${parsed.length} 条任务。`);
      return {
        pricingCsv: out.pricingCsv,
        tasksCsv: out.tasksCsv,
        profilesCsv: out.profilesCsv,
        taskRows: parsed,
        taskCount: parsed.length,
        log: "ok",
      };
    },

    _runScript(py, name, onLog) {
      // 在受控命名空间里 exec，cwd 设为 /repo/scripts 让 ROOT=parents[1]=/repo
      const driver = `
import runpy, sys, traceback, os
os.chdir("/repo/scripts")
if "/repo/scripts" not in sys.path:
    sys.path.insert(0, "/repo/scripts")
try:
    runpy.run_path("/repo/scripts/${name}", run_name="__main__")
    _wf_err = ""
except SystemExit as e:
    _wf_err = "" if (e.code in (0, None)) else f"脚本以退出码 {e.code} 结束"
except Exception:
    _wf_err = traceback.format_exc()
_wf_err
`;
      const err = py.runPython(driver);
      if (err) throw new Error(`${name} 运行失败：\n${err}`);
      return Promise.resolve();
    },
  };

  // 极简 CSV 解析（处理引号/逗号），仅用于页面预览
  function parseTasks(csv) {
    if (!csv) return [];
    const rows = csvToRows(csv);
    if (rows.length < 2) return [];
    const head = rows[0];
    const idx = (name) => head.findIndex((h) => h.trim() === name);
    const cP = idx("优先级"), cS = idx("SKU"), cT = idx("类型"),
      cR = idx("触发原因"), cA = idx("建议动作");
    return rows.slice(1).filter((r) => r.length > 1).map((r) => ({
      priority: cP >= 0 ? r[cP] : "",
      sku: cS >= 0 ? r[cS] : "",
      type: cT >= 0 ? r[cT] : "",
      reason: cR >= 0 ? r[cR] : "",
      action: cA >= 0 ? r[cA] : "",
    }));
  }

  function csvToRows(text) {
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else {
        if (c === '"') q = true;
        else if (c === ",") { row.push(cur); cur = ""; }
        else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
        else if (c === "\r") { /* skip */ }
        else cur += c;
      }
    }
    if (cur.length || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  window.WFAnalysis = WFAnalysis;
})();
