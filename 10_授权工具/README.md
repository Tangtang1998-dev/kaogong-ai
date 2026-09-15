# 离线授权工具

## 桌面授权管理器

管理员日常给用户发授权码，直接运行：

```text
10_授权工具\发布版\行测AI授权管理器.exe
```

桌面版支持单用户授权、批量授权、套餐有效期、激活码校验、客户消息复制、TXT/CSV 导出和本地授权记录。`密钥\private-key.json` 必须与 EXE 保持相对位置，不能发给客户。

重新打包桌面版：

```powershell
powershell -ExecutionPolicy Bypass -File "10_授权工具\admin\build.ps1"
```

## 命令行工具

`private-key.json` 是签发激活码的私钥，只保存在本机。不要上传到 GitHub、Gitee、网页或 APK。

生成月卡：

```powershell
node generate-license.mjs --plan=month --device=XC-XXXX-XXXX-XXXX
```

生成半年卡：

```powershell
node generate-license.mjs --plan=halfyear --device=XC-XXXX-XXXX-XXXX
```

生成年卡：

```powershell
node generate-license.mjs --plan=year --device=XC-XXXX-XXXX-XXXX
```

生成季度卡：

```powershell
node generate-license.mjs --plan=quarter --device=XC-XXXX-XXXX-XXXX
```

生成国考季票：

```powershell
node generate-license.mjs --plan=gk --device=XC-XXXX-XXXX-XXXX
```

生成省考季票：

```powershell
node generate-license.mjs --plan=province --exam=guizhou --expire=2027-03-20 --device=XC-XXXX-XXXX-XXXX
```

把输出的 `code` 发给用户，用户在项目“购买与激活”页粘贴即可。
