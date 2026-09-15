# 离线授权工具

`private-key.json` 是签发激活码的私钥，只保存在本机。不要上传到 GitHub、Gitee、网页或 APK。

生成月卡：

```powershell
node generate-license.mjs --plan=month --device=XC-XXXX-XXXX-XXXX
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
