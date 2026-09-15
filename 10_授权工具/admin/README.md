# 行测 AI 授权管理器

本地桌面授权器，用于离线付费版本的单用户授权、批量授权、激活码校验和授权记录管理。

## 安全边界

- EXE 不包含私钥，启动时优先从 EXE 同级的 `密钥\private-key.json` 读取。
- 私钥与客户端公钥不匹配时会拒绝生成。
- 授权记录包含激活码，默认写入 EXE 同级的 `授权记录` 目录。
- `发布版`、构建目录和私钥均不应提交到 Git。

## 开发运行

```powershell
cd "10_授权工具\admin"
python license_admin_app.py
```

## 测试

```powershell
python -m unittest discover -s . -p "test_*.py" -v
python license_admin_app.py --self-test --report self-test.json
```

## 打包 EXE

```powershell
powershell -ExecutionPolicy Bypass -File ".\build.ps1"
```

输出目录：`10_授权工具\发布版`。

## 套餐规则

- `month`：单月订阅，签发日起 30 天。
- `quarter`：签发日起 90 天。
- `halfyear`：半年卡，签发日起 180 天，不自动扣款。
- `year`：年卡，签发日起 365 天，不自动扣款。
- `gk`：固定到 2026-12-06 国考笔试结束。
- `province`：管理员按本省考试周期填写到期日期。
