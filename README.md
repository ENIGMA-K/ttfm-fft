# TTFM 波形 FFT 分析（科研原型）

在线访问：**https://enigma-k.github.io/ttfm-fft/**

依据 Takami 2024（J Cardiothorac Surg 2024;19:635）的 FFT 比值方法：**FFT ratio = F0/H1**（基频功率 ÷ 一次谐波功率），≥1.0 提示桥血管通畅倾向，<1.0 提示吻合口问题可能。

单文件网页应用：拍照/截图 → 自动识别波形与坐标轴 → 计算 FFT 比值、分类、频谱、估算 HR 与 Qm/PI；坐标轴可拖动微调并实时重算。

> [!WARNING] 重要声明
> 本工具为**科研与教学原型，非医疗器械**。结果未经临床验证，**不得用于临床诊断、治疗或手术决策**。图像仅在本机浏览器内处理、不上传网络；请勿使用包含患者隐私的图像。

## 功能

- 波形面板与曲线自动提取（彩色/暗墨双通道，Viterbi 追踪）
- x（时间）/ y（幅值）轴自动识别（刻度 + 数字模板 OCR，尽力而为）与可拖动微调
- FFT 比值 F0/H1 + 分类（≥1.1 倾向通畅 / 0.9–1.1 临界 / <0.9 疑似问题；原文阈值 1.0，本工具设 ±0.1 灰区）
- 频谱图（F0/H1 标注）、估算心率、Qm/PI 估算、质量分与失败提示
- 全部离线、零依赖、单文件

## 使用

1. 打开 https://enigma-k.github.io/ttfm-fft/ 或本地双击 `ttfm-fft.html`。
2. 点「载入示例波形」自检（应得到 FFT 比值 ≈2.5、HR ≈75）。
3. 拍照/选择波形截图，等待自动分析。
4. 用「轴调整」或拖动预览图手柄修正标定；「恢复自动识别」还原。

## 原理

- Hann 窗 + 补零 4096 + 自实现 radix-2 Cooley–Tukey FFT；在 0.5–2.2 Hz（无标定时用自相关基频）搜索 P(f)+P(2f) 谐波对，并惩罚把 2f0 当 f0 的解。
- 比值用最小二乘拟合 f0 与 2f0 的正弦/余弦振幅求得，降低频点偏移/泄漏影响；比值对幅值线性缩放不敏感，时间轴缩放只影响 HR。
- 曲线提取：4× 块池化颜色/暗墨掩膜 → 连通域选面板 → 列内墨段 Viterbi 追踪 → 插值/中值滤波。

## 验证（2026-11-23）

- `node --test` **10/10 通过**：FFT 与朴素 DFT 对照；合成比值 0.6/1.0/1.5/2.5 × HR 55/75/95（误差 ≤2%）；SNR 10 dB + 缺口 5%/15%（≤12%，分类稳定）；SNR 3 dB 分类稳健；自适应频带 HR 35/150；幅值/时间缩放不变性；合成图像面板/曲线/轴端到端（覆盖 ≥0.9、x 标定 <3%、y 斜率 <5%、HR ±3、比值 ≤12%）。
- 浏览器端到端：示例 FFT 比值 **2.507**、HR **75.0**、Qm **56.3**、PI **1.14**、覆盖 98.4%。
- 真实图：论文 Fig 3 波形带裁剪 FFT 比值 **2.30**（论文图示 ≈2.7；裁剪覆盖率 0.35，属低质量样本）。

详见 `test/e2e.md` 与截图 `test/e2e-desktop.png`、`test/e2e-mobile.png`。

## 已知局限

- 拍屏反光/摩尔纹/透视、裁掉扫描窗口、文字遮挡波形 → 可能失败或质量低；以“质量：低”提示为准。
- 自动轴 OCR 为尽力而为（设备字体差异大）；失败时用轴调整。x 未标定时 HR 不可用，但 FFT 比值仍可计算。
- 自动选择评分最高面板（无手动切换面板）；主要用于 LITA/SVG-LAD 常见展示形态；RA/复合/序贯桥未验证。
- 与设备内置 FFT 不完全等价（窗函数、滤波、取段差异）；结果为估算值。Fig 4 四象限真图验证未完成。

## 引用与致谢

Takami Y, Maekawa A, Yamana K, Akita K, Amano K, Matsuhashi K, Niwa W, Takagi Y. Fast Fourier transform analysis of intraoperative transit-time flow measurement during coronary artery bypass grafting. *J Cardiothorac Surg.* 2024;19:635. doi:[10.1186/s13019-024-03135-6](https://doi.org/10.1186/s13019-024-03135-6)

本仓库为方法的**独立实现**，不包含论文图片（论文为 CC BY-NC-ND 4.0）。Medi-Stim 是其权利人商标，本工具与设备厂商无关联。

## 目录

```
ttfm-fft.html      # 单文件应用（GitHub Pages 入口经 index.html 跳转）
index.html         # 跳转到 ttfm-fft.html
test/              # 单元测试（node --test）与端到端记录/截图
```

## 开发与测试

```bash
node --test test/core.test.mjs
```

测试从 `ttfm-fft.html` 的 `CORE:BEGIN/END` 标记块抽取纯函数执行；修改时请保留标记。

## 许可

本仓库未附 License，默认**保留所有权利**（All rights reserved）。未经许可不得再分发或再许可。
