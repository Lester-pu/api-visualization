# api-visualization-final

推荐最终架构：

```text
                    ┌──────────────────────────────┐
                    │         React + Vite UI       │
                    │  - 完整画布交互               │
                    │  - 拖拽 / 缩放 / 折叠 / focus │
                    │  - Excel / Zip 上传           │
                    └──────────────┬───────────────┘
                                   │ HTTP / JSON
                    ┌──────────────▼───────────────┐
                    │        FastAPI Backend        │
                    │  - /api/workbook/parse        │
                    │  - /api/mule/scan             │
                    │  - /api/health                │
                    └──────────────┬───────────────┘
                                   │
         ┌─────────────────────────┼─────────────────────────┐
         │                         │                         │
┌────────▼────────┐      ┌────────▼────────┐      ┌────────▼────────┐
│ workbook service│      │ mule parser     │      │ graph service   │
│ - Excel 契约     │      │ - repo/zip 解析  │      │ - workbook->图  │
│ - Notes/Relations│      │ - YAML/XML 规则 │      │ - summary/insight│
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                         │                         │
         └─────────────────────────┴─────────────────────────┘
                                   │
                           ┌───────▼────────┐
                           │  pytest / CLI   │
                           │ - 回归测试       │
                           │ - 本地批处理     │
                           └──────────────────┘
```

## 目录

```text
api-visualization-final/
├─ backend/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ api.py
│  │  ├─ cli.py
│  │  └─ services/
│  ├─ tests/
│  └─ requirements.txt
├─ frontend/
│  ├─ src/
│  ├─ package.json
│  └─ vite.config.js
└─ README.md
```

## 设计原则

- 保留旧版完整画布功能，不缩减
- 解析逻辑统一在 Python 后端
- 前端只负责完整交互与可视化
- CLI/API/测试共用同一套解析核心

## 启动与停止

项目根目录只保留一对统一脚本：

- 启动：`start-services.ps1`
- 停止：`stop-services.ps1`

首次使用前仍需先安装依赖：

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt

cd ..\frontend
npm install
```

启动全部服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-services.ps1
```

停止全部服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-services.ps1
```

默认地址：

```text
Frontend: http://127.0.0.1:3000
Backend:  http://127.0.0.1:8000
```

## 公网发布

推荐方案：

- 前端部署到 **GitHub Pages**
- 后端部署到 **Render**（或同类 Python Web Service）

### GitHub Pages

前端已配置仓库 base 路径：

```text
/api-visualization/
```

仓库地址：

```text
https://github.com/Lester-pu/api-visualization
```

需要在 GitHub 仓库中：

1. `Settings` → `Pages`
2. Source 选择 **GitHub Actions**
3. 在 `Settings` → `Secrets and variables` → `Actions` 中添加：

```text
VITE_API_BASE_URL=https://<your-render-service>.onrender.com
```

发布后前端地址预计为：

```text
https://lester-pu.github.io/api-visualization/
```

### Render 后端

建议将仓库连接到 Render，Root Directory 设为：

```text
backend
```

Build Command:

```text
pip install -r requirements.txt
```

Start Command:

```text
uvicorn app.main:app --host 0.0.0.0 --port 10000
```

后端部署成功后，把 Render 域名填入 GitHub Actions Secret `VITE_API_BASE_URL`。
