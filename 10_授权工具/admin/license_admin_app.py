"""Windows desktop license manager for the offline paid release."""

from __future__ import annotations

import argparse
import csv
import ctypes
import json
import os
import sys
import tkinter as tk
from datetime import datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk
from typing import Any

from license_core import (
    CHINA_TZ,
    PLANS,
    LicenseError,
    LicenseResult,
    RecordStore,
    decode_license,
    format_china_time,
    generate_license,
    load_private_key,
    locate_private_key,
    normalize_device_code,
    self_test,
    verify_license,
)


APP_NAME = "行测 AI 授权管理器"
APP_VERSION = "1.0.0"
BG = "#F3F6FB"
CARD = "#FFFFFF"
TEXT = "#172033"
MUTED = "#667085"
BORDER = "#D9E1EC"
PRIMARY = "#1D4ED8"
PRIMARY_DARK = "#173EA8"
SUCCESS = "#0F8A5F"
DANGER = "#C2413B"
SOFT_BLUE = "#EAF1FF"
SOFT_RED = "#FDECEC"


def app_directory() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def set_windows_dpi_awareness() -> None:
    if os.name != "nt":
        return
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


def parse_plan_display(display: str) -> str:
    return str(display).split("|", 1)[0].strip()


class LicenseAdminApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title(f"{APP_NAME} v{APP_VERSION}")
        self.geometry("1180x790")
        self.minsize(1000, 690)
        self.configure(bg=BG)
        self.option_add("*Font", ("Microsoft YaHei UI", 10))

        self.app_dir = app_directory()
        self.records = RecordStore(self.app_dir / "授权记录")
        self.private_key = None
        self.private_key_path: Path | None = None
        self.current_result: LicenseResult | None = None
        self.batch_results: list[LicenseResult] = []
        self.history_rows: list[dict[str, str]] = []

        self._set_icon()
        self._configure_styles()
        self._build_ui()
        self.after(80, self._auto_load_private_key)

    def _set_icon(self) -> None:
        ico = self.app_dir / "app.ico"
        if ico.exists():
            try:
                self.iconbitmap(str(ico))
            except tk.TclError:
                pass

    def _configure_styles(self) -> None:
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TNotebook", background=BG, borderwidth=0)
        style.configure("TNotebook.Tab", padding=(18, 10), font=("Microsoft YaHei UI", 10, "bold"))
        style.map("TNotebook.Tab", background=[("selected", CARD), ("!selected", BG)], foreground=[("selected", PRIMARY), ("!selected", MUTED)])
        style.configure("TCombobox", padding=5, font=("Microsoft YaHei UI", 10))
        style.configure("Treeview", rowheight=30, font=("Microsoft YaHei UI", 9), background=CARD, fieldbackground=CARD)
        style.configure("Treeview.Heading", font=("Microsoft YaHei UI", 9, "bold"), padding=6)
        style.map("Treeview", background=[("selected", "#DCE8FF")], foreground=[("selected", TEXT)])
        style.configure("Vertical.TScrollbar", width=14)

    def _card(self, parent: tk.Misc, **pack_options: Any) -> tk.Frame:
        card = tk.Frame(parent, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        if pack_options:
            card.pack(**pack_options)
        return card

    def _button(self, parent: tk.Misc, text: str, command: Any, *, primary: bool = False, danger: bool = False, width: int | None = None) -> tk.Button:
        if primary:
            bg, active_bg, fg = PRIMARY, PRIMARY_DARK, "#FFFFFF"
        elif danger:
            bg, active_bg, fg = SOFT_RED, "#FAD7D5", DANGER
        else:
            bg, active_bg, fg = "#FFFFFF", SOFT_BLUE, PRIMARY
        return tk.Button(
            parent,
            text=text,
            command=command,
            bg=bg,
            activebackground=active_bg,
            fg=fg,
            activeforeground=DANGER if danger else (fg if primary else PRIMARY),
            disabledforeground="#98A2B3",
            relief="flat",
            bd=0,
            padx=14,
            pady=8,
            cursor="hand2",
            font=("Microsoft YaHei UI", 10, "bold"),
            width=width,
            highlightthickness=1,
            highlightbackground=BORDER if not primary and not danger else bg,
        )

    def _label(self, parent: tk.Misc, text: str, *, color: str = TEXT, size: int = 10, bold: bool = False, bg: str = CARD) -> tk.Label:
        return tk.Label(parent, text=text, bg=bg, fg=color, font=("Microsoft YaHei UI", size, "bold" if bold else "normal"), anchor="w")

    def _entry(self, parent: tk.Misc, variable: tk.StringVar) -> tk.Entry:
        return tk.Entry(
            parent,
            textvariable=variable,
            relief="flat",
            bd=0,
            bg="#F8FAFC",
            fg=TEXT,
            insertbackground=PRIMARY,
            highlightthickness=1,
            highlightbackground=BORDER,
            highlightcolor=PRIMARY,
            font=("Microsoft YaHei UI", 10),
        )

    def _subtitle(self, parent: tk.Misc, text: str, *, bg: str = CARD) -> tk.Label:
        return self._label(parent, text, color=MUTED, size=9, bg=bg)

    def _build_ui(self) -> None:
        self._build_header()
        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=18, pady=(12, 8))

        self.single_tab = tk.Frame(self.notebook, bg=BG)
        self.batch_tab = tk.Frame(self.notebook, bg=BG)
        self.history_tab = tk.Frame(self.notebook, bg=BG)
        self.help_tab = tk.Frame(self.notebook, bg=BG)
        self.notebook.add(self.single_tab, text="单用户授权")
        self.notebook.add(self.batch_tab, text="批量授权")
        self.notebook.add(self.history_tab, text="授权记录")
        self.notebook.add(self.help_tab, text="使用说明")

        self._build_single_tab()
        self._build_batch_tab()
        self._build_history_tab()
        self._build_help_tab()
        self._build_statusbar()

    def _build_header(self) -> None:
        header = tk.Frame(self, bg="#162B58", height=86)
        header.pack(fill="x")
        header.pack_propagate(False)
        left = tk.Frame(header, bg="#162B58")
        left.pack(side="left", fill="y", padx=22, pady=14)
        tk.Label(left, text=APP_NAME, bg="#162B58", fg="#FFFFFF", font=("Microsoft YaHei UI", 19, "bold"), anchor="w").pack(anchor="w")
        tk.Label(left, text="离线签名 · 设备绑定 · 批量生成 · 本地记录", bg="#162B58", fg="#BFD0F3", font=("Microsoft YaHei UI", 9), anchor="w").pack(anchor="w", pady=(3, 0))
        right = tk.Frame(header, bg="#162B58")
        right.pack(side="right", fill="y", padx=22, pady=13)
        self.key_status = tk.Label(right, text="正在检查私钥…", bg="#233E75", fg="#DCE7FF", padx=12, pady=6, font=("Microsoft YaHei UI", 9, "bold"))
        self.key_status.pack(side="left", padx=(0, 8))
        self._button(right, "重新加载", self._choose_private_key, width=9).pack(side="left", padx=3)
        self._button(right, "校验激活码", self.open_verify_dialog, width=10).pack(side="left", padx=3)

    def _build_statusbar(self) -> None:
        bar = tk.Frame(self, bg="#E8EDF5", height=30)
        bar.pack(fill="x", side="bottom")
        bar.pack_propagate(False)
        self.status_var = tk.StringVar(value="就绪")
        tk.Label(bar, textvariable=self.status_var, bg="#E8EDF5", fg=MUTED, font=("Microsoft YaHei UI", 9), anchor="w").pack(fill="x", padx=18)

    def _build_single_tab(self) -> None:
        wrapper = tk.Frame(self.single_tab, bg=BG)
        wrapper.pack(fill="both", expand=True, padx=2, pady=8)
        wrapper.grid_columnconfigure(0, weight=5, uniform="single")
        wrapper.grid_columnconfigure(1, weight=6, uniform="single")
        wrapper.grid_rowconfigure(0, weight=1)

        form = self._card(wrapper)
        form.grid(row=0, column=0, sticky="nsew", padx=(0, 8), pady=0)
        result = self._card(wrapper)
        result.grid(row=0, column=1, sticky="nsew", padx=(8, 0), pady=0)

        self._label(form, "授权信息", size=14, bold=True).pack(anchor="w", padx=22, pady=(18, 2))
        self._subtitle(form, "设备码由用户在“会员”页面复制，授权码只对该设备有效。").pack(anchor="w", padx=22, pady=(0, 14))

        self.device_var = tk.StringVar()
        self.customer_var = tk.StringVar()
        self.order_var = tk.StringVar()
        self.customer_note_var = tk.StringVar()
        self.plan_var = tk.StringVar()
        self.province_var = tk.StringVar()
        self.province_expire_var = tk.StringVar()

        self._field(form, "设备码 *", self.device_var)
        paste_row = tk.Frame(form, bg=CARD)
        paste_row.pack(fill="x", padx=22, pady=(3, 0))
        self._button(paste_row, "粘贴并识别", self.paste_device_code).pack(side="left")
        self._button(paste_row, "清空设备码", lambda: self.device_var.set("")).pack(side="left", padx=6)

        self._field(form, "客户名称 / 微信昵称", self.customer_var, top=12)
        self._field(form, "订单号（可选）", self.order_var, top=12)
        self._field(form, "备注（只保存本地记录）", self.customer_note_var, top=12)

        self._label(form, "套餐", bold=True).pack(anchor="w", padx=22, pady=(14, 5))
        self.plan_combo = ttk.Combobox(
            form,
            textvariable=self.plan_var,
            state="readonly",
            values=[f"{key} | {value['name']} · ¥{value['price']}" for key, value in PLANS.items()],
            height=5,
        )
        self.plan_combo.pack(fill="x", padx=22)
        self.plan_combo.set("month | 单月订阅 · ¥39")
        self.plan_combo.bind("<<ComboboxSelected>>", self._on_single_plan_change)

        self.plan_hint = self._subtitle(form, "单月订阅：一次购买 30 天；到期不自动扣款")
        self.plan_hint.pack(anchor="w", padx=22, pady=(5, 0))

        self.province_box = tk.Frame(form, bg=CARD)
        self._label(self.province_box, "省考名称", bold=True).pack(anchor="w")
        self.province_entry = self._entry(self.province_box, self.province_var)
        self.province_entry.pack(fill="x", pady=(5, 10))
        self._label(self.province_box, "到期日期（YYYY-MM-DD）", bold=True).pack(anchor="w")
        self.province_expire_entry = self._entry(self.province_box, self.province_expire_var)
        self.province_expire_entry.pack(fill="x", pady=(5, 0))

        self.generate_button = self._button(form, "生成授权码", self.generate_single, primary=True)
        self.generate_button.pack(fill="x", padx=22, pady=(18, 20), ipady=5)

        self._label(result, "授权结果", size=14, bold=True).pack(anchor="w", padx=22, pady=(18, 2))
        self._subtitle(result, "生成后可直接复制完整客户消息，或保存为单独文件。").pack(anchor="w", padx=22, pady=(0, 12))

        meta = tk.Frame(result, bg=SOFT_BLUE, highlightbackground="#C9D9FF", highlightthickness=1)
        meta.pack(fill="x", padx=22, pady=(0, 12))
        self.result_plan_var = tk.StringVar(value="等待生成")
        self.result_device_var = tk.StringVar(value="-")
        self.result_expire_var = tk.StringVar(value="-")
        self.result_id_var = tk.StringVar(value="-")
        self._result_meta(meta, "套餐", self.result_plan_var)
        self._result_meta(meta, "授权设备", self.result_device_var)
        self._result_meta(meta, "到期时间", self.result_expire_var)
        self._result_meta(meta, "授权编号", self.result_id_var)

        self._label(result, "激活码", bold=True).pack(anchor="w", padx=22)
        self.code_text = tk.Text(result, height=5, wrap="char", relief="flat", bd=0, bg="#F8FAFC", fg=TEXT, padx=10, pady=9, font=("Consolas", 9), highlightthickness=1, highlightbackground=BORDER)
        self.code_text.pack(fill="x", padx=22, pady=(5, 10))
        self.code_text.configure(state="disabled")

        code_actions = tk.Frame(result, bg=CARD)
        code_actions.pack(fill="x", padx=22)
        self._button(code_actions, "复制激活码", self.copy_activation_code, primary=True).pack(side="left")
        self._button(code_actions, "复制客户消息", self.copy_customer_message).pack(side="left", padx=6)
        self._button(code_actions, "保存为 TXT", self.save_single_txt).pack(side="left")

        self._label(result, "客户消息预览", bold=True).pack(anchor="w", padx=22, pady=(14, 5))
        self.message_text = tk.Text(result, height=9, wrap="word", relief="flat", bd=0, bg="#FBFCFE", fg=TEXT, padx=10, pady=9, font=("Microsoft YaHei UI", 9), highlightthickness=1, highlightbackground=BORDER)
        self.message_text.pack(fill="both", expand=True, padx=22, pady=(0, 18))
        self.message_text.configure(state="disabled")
        self._on_single_plan_change()

    def _field(self, parent: tk.Misc, label: str, variable: tk.StringVar, *, top: int = 0) -> None:
        self._label(parent, label, bold=True).pack(anchor="w", padx=22, pady=(top, 5))
        self._entry(parent, variable).pack(fill="x", padx=22, ipady=7)

    def _result_meta(self, parent: tk.Misc, label: str, variable: tk.StringVar) -> None:
        row = tk.Frame(parent, bg=SOFT_BLUE)
        row.pack(fill="x", padx=12, pady=5)
        tk.Label(row, text=label, bg=SOFT_BLUE, fg=MUTED, width=10, anchor="w", font=("Microsoft YaHei UI", 9)).pack(side="left")
        tk.Label(row, textvariable=variable, bg=SOFT_BLUE, fg=TEXT, anchor="w", font=("Microsoft YaHei UI", 9, "bold")).pack(side="left", fill="x", expand=True)

    def _on_single_plan_change(self, _event: Any = None) -> None:
        plan = parse_plan_display(self.plan_var.get())
        if hasattr(self, "plan_hint"):
            self.plan_hint.configure(text=str(PLANS.get(plan, {}).get("description", "")))
        if hasattr(self, "province_box"):
            if plan == "province":
                self.province_box.pack(fill="x", padx=22, pady=(12, 0), before=self.generate_button)
            else:
                self.province_box.pack_forget()

    def _build_batch_tab(self) -> None:
        wrapper = tk.Frame(self.batch_tab, bg=BG)
        wrapper.pack(fill="both", expand=True, padx=2, pady=8)
        wrapper.grid_columnconfigure(0, weight=4, uniform="batch")
        wrapper.grid_columnconfigure(1, weight=7, uniform="batch")
        wrapper.grid_rowconfigure(0, weight=1)

        form = self._card(wrapper)
        form.grid(row=0, column=0, sticky="nsew", padx=(0, 8))
        table_card = self._card(wrapper)
        table_card.grid(row=0, column=1, sticky="nsew", padx=(8, 0))

        self._label(form, "批量生成", size=14, bold=True).pack(anchor="w", padx=20, pady=(18, 2))
        self._subtitle(form, "每行一个用户：设备码,客户名称,订单号,备注。后三项可省略。").pack(anchor="w", padx=20, pady=(0, 12))

        self.batch_plan_var = tk.StringVar()
        self.batch_province_expire_var = tk.StringVar()
        self.batch_province_name_var = tk.StringVar()
        self._label(form, "套餐", bold=True).pack(anchor="w", padx=20, pady=(4, 5))
        self.batch_plan_combo = ttk.Combobox(
            form,
            textvariable=self.batch_plan_var,
            state="readonly",
            values=[f"{key} | {value['name']} · ¥{value['price']}" for key, value in PLANS.items()],
            height=5,
        )
        self.batch_plan_combo.pack(fill="x", padx=20)
        self.batch_plan_combo.set("month | 单月订阅 · ¥39")
        self.batch_plan_combo.bind("<<ComboboxSelected>>", self._on_batch_plan_change)

        self.batch_province_box = tk.Frame(form, bg=CARD)
        self._label(self.batch_province_box, "省考名称", bold=True).pack(anchor="w")
        self._entry(self.batch_province_box, self.batch_province_name_var).pack(fill="x", pady=(5, 10))
        self._label(self.batch_province_box, "统一到期日期（YYYY-MM-DD）", bold=True).pack(anchor="w")
        self._entry(self.batch_province_box, self.batch_province_expire_var).pack(fill="x", pady=(5, 0))

        self._label(form, "用户列表", bold=True).pack(anchor="w", padx=20, pady=(14, 5))
        self.batch_input = tk.Text(form, height=13, wrap="none", relief="flat", bd=0, bg="#F8FAFC", fg=TEXT, padx=10, pady=9, font=("Consolas", 9), highlightthickness=1, highlightbackground=BORDER)
        self.batch_input.pack(fill="both", expand=True, padx=20)
        self.batch_input.insert("1.0", "XC-XXXX-XXXX-XXXX,张三,ORDER-001,月付\n")

        actions = tk.Frame(form, bg=CARD)
        actions.pack(fill="x", padx=20, pady=14)
        self._button(actions, "批量生成", self.generate_batch, primary=True).pack(side="left")
        self._button(actions, "导入 CSV", self.import_batch_csv).pack(side="left", padx=6)
        self._button(actions, "清空", self.clear_batch).pack(side="left")

        self._label(table_card, "生成结果", size=14, bold=True).pack(anchor="w", padx=18, pady=(18, 2))
        self._subtitle(table_card, "双击某一行可复制该用户的完整激活码。").pack(anchor="w", padx=18, pady=(0, 10))
        columns = ("device", "customer", "plan", "expire", "order", "id")
        self.batch_tree = ttk.Treeview(table_card, columns=columns, show="headings")
        headers = {"device": "设备码", "customer": "客户", "plan": "套餐", "expire": "到期时间", "order": "订单号", "id": "授权编号"}
        widths = {"device": 145, "customer": 80, "plan": 90, "expire": 140, "order": 90, "id": 120}
        for key in columns:
            self.batch_tree.heading(key, text=headers[key])
            self.batch_tree.column(key, width=widths[key], minwidth=60, stretch=key in {"customer", "order"})
        self.batch_tree.pack(fill="both", expand=True, padx=18, pady=(0, 10))
        self.batch_tree.bind("<Double-1>", lambda _e: self.copy_selected_batch())

        table_actions = tk.Frame(table_card, bg=CARD)
        table_actions.pack(fill="x", padx=18, pady=(0, 18))
        self._button(table_actions, "复制选中激活码", self.copy_selected_batch, primary=True).pack(side="left")
        self._button(table_actions, "导出全部结果为 CSV", self.export_batch_csv).pack(side="left", padx=6)
        self._on_batch_plan_change()

    def _on_batch_plan_change(self, _event: Any = None) -> None:
        plan = parse_plan_display(self.batch_plan_var.get())
        if not hasattr(self, "batch_province_box"):
            return
        if plan == "province":
            self.batch_province_box.pack(fill="x", padx=20, pady=(12, 0), before=self.batch_input)
        else:
            self.batch_province_box.pack_forget()

    def _build_history_tab(self) -> None:
        card = self._card(self.history_tab)
        card.pack(fill="both", expand=True, padx=2, pady=8)

        top = tk.Frame(card, bg=CARD)
        top.pack(fill="x", padx=18, pady=(18, 10))
        self._label(top, "授权记录", size=14, bold=True).pack(side="left")
        self.history_search_var = tk.StringVar()
        search = self._entry(top, self.history_search_var)
        search.configure(width=32)
        search.pack(side="right", ipady=6)
        search.bind("<KeyRelease>", lambda _e: self.refresh_history())
        tk.Label(top, text="搜索：", bg=CARD, fg=MUTED, font=("Microsoft YaHei UI", 9)).pack(side="right", padx=(0, 6))

        self._subtitle(card, f"本地记录文件：{self.records.csv_path}").pack(anchor="w", padx=18, pady=(0, 10))
        columns = ("generated", "customer", "device", "plan", "expire", "order", "id")
        self.history_tree = ttk.Treeview(card, columns=columns, show="headings")
        headers = {"generated": "生成时间", "customer": "客户", "device": "设备码", "plan": "套餐", "expire": "到期时间", "order": "订单号", "id": "授权编号"}
        widths = {"generated": 135, "customer": 90, "device": 145, "plan": 85, "expire": 135, "order": 95, "id": 115}
        for key in columns:
            self.history_tree.heading(key, text=headers[key])
            self.history_tree.column(key, width=widths[key], minwidth=60, stretch=key in {"customer", "order"})
        self.history_tree.pack(fill="both", expand=True, padx=18)
        self.history_tree.bind("<Double-1>", self.show_history_detail)

        actions = tk.Frame(card, bg=CARD)
        actions.pack(fill="x", padx=18, pady=16)
        self._button(actions, "刷新", self.refresh_history).pack(side="left")
        self._button(actions, "复制选中激活码", self.copy_history_code, primary=True).pack(side="left", padx=6)
        self._button(actions, "导出备份", self.export_history).pack(side="left")
        self._button(actions, "打开记录文件夹", self.open_records_folder).pack(side="left", padx=6)

    def _build_help_tab(self) -> None:
        card = self._card(self.help_tab)
        card.pack(fill="both", expand=True, padx=2, pady=8)
        self._label(card, "使用说明", size=15, bold=True).pack(anchor="w", padx=26, pady=(22, 8))
        text = tk.Text(card, wrap="word", relief="flat", bd=0, bg=CARD, fg=TEXT, padx=10, pady=6, font=("Microsoft YaHei UI", 10), spacing1=3, spacing3=6)
        text.pack(fill="both", expand=True, padx=18, pady=(0, 18))
        text.insert("1.0", """授权流程
1. 客户在软件或网页的“会员”页面查看套餐详解并复制设备码，通过粉丝群发送给你。
2. 在“单用户授权”中粘贴设备码，选择客户实际购买的套餐，填写客户名称和订单号。选择套餐后会显示该套餐的到期与续费规则。
3. 生成后先复制客户消息，把套餐、设备码、到期时间和激活码发给客户；客户在软件的“会员”页面输入激活码即可。
4. 所有套餐均为一次付款、固定有效期，不自动扣款；续费时用同一设备码重新生成新激活码即可。半年卡为 180 天，年卡为 365 天。

批量授权
每行格式为：设备码,客户名称,订单号,备注。导入 CSV 时支持 device、customer、order_id、note 表头，也支持上述列顺序。批量生成完成后可一键导出结果。

安全规则
1. 私钥文件 private-key.json 是最高机密，绝不能发给客户、上传群文件或提交到代码仓库。
2. 建议把私钥和本软件放在同一文件夹，并另外备份到只有你能访问的加密磁盘。
3. 本软件不会把私钥编译进 EXE；如果私钥丢失，以后将无法为同一公钥体系生成新激活码。
4. 激活码只能绑定一个设备码，不能把同一个激活码发给多个客户。
5. 授权记录默认保存在 EXE 同级的“授权记录”文件夹，包含激活码，请勿对外公开。

常见续费建议
月付到期前 2-3 天提醒续费；季度付和季票建议提前 7 天提醒。客户更换设备或清理浏览器数据后设备码会变化，应核对订单后按新设备码重新签发。
""")
        text.configure(state="disabled")

    def _auto_load_private_key(self) -> None:
        path = locate_private_key(self.app_dir)
        if path:
            self._load_key_file(path)
        else:
            self._set_key_status(False, "未找到 private-key.json，请手动选择")
            self.set_status("授权器可以打开，但生成激活码前必须加载正确的私钥文件。")

    def _choose_private_key(self) -> None:
        initial = str(self.private_key_path.parent if self.private_key_path else self.app_dir)
        path = filedialog.askopenfilename(title="选择离线授权私钥", initialdir=initial, filetypes=[("JSON 私钥", "*.json"), ("所有文件", "*.*")])
        if path:
            self._load_key_file(Path(path))

    def _load_key_file(self, path: Path) -> None:
        try:
            key, _ = load_private_key(path)
        except LicenseError as exc:
            self.private_key = None
            self.private_key_path = None
            self._set_key_status(False, "私钥未加载")
            self.set_status(str(exc))
            messagebox.showerror("私钥加载失败", str(exc), parent=self)
            return
        self.private_key = key
        self.private_key_path = path.resolve()
        self._set_key_status(True, "私钥已就绪")
        self.set_status(f"已加载私钥：{self.private_key_path.name}")

    def _set_key_status(self, ok: bool, text: str) -> None:
        self.key_status.configure(text=text, bg="#145C49" if ok else "#7A2E2A", fg="#FFFFFF")

    def set_status(self, text: str) -> None:
        if hasattr(self, "status_var"):
            self.status_var.set(text)

    def paste_device_code(self) -> None:
        try:
            raw = self.clipboard_get()
        except tk.TclError:
            self.set_status("剪贴板中没有可读取的文字。")
            return
        self.device_var.set(normalize_device_code(raw))
        self.set_status("设备码已从剪贴板读取并规范化。")

    def _require_key(self):
        if not self.private_key:
            self._choose_private_key()
        if not self.private_key:
            raise LicenseError("请先加载正确的私钥文件")
        return self.private_key

    def generate_single(self) -> None:
        try:
            key = self._require_key()
            plan = parse_plan_display(self.plan_var.get())
            result = generate_license(
                key,
                self.device_var.get(),
                plan,
                expire_date=self.province_expire_var.get(),
                exam=(self.province_var.get() if plan == "province" else ("national" if plan == "gk" else "")),
                customer=self.customer_var.get(),
                order_id=self.order_var.get(),
                note=self.customer_note_var.get(),
            )
            self.records.append(result)
            self.current_result = result
            self._show_single_result(result)
            self.refresh_history()
            self.set_status(f"授权码已生成并写入本地记录：{result.license_id}")
        except (LicenseError, OSError) as exc:
            messagebox.showerror("无法生成授权码", str(exc), parent=self)
            self.set_status(str(exc))

    def _show_single_result(self, result: LicenseResult) -> None:
        self.result_plan_var.set(result.label)
        self.result_device_var.set(result.device)
        self.result_expire_var.set(result.expire_text)
        self.result_id_var.set(result.license_id)
        self._set_text(self.code_text, result.code)
        self._set_text(self.message_text, result.customer_message)

    def _set_text(self, widget: tk.Text, value: str) -> None:
        widget.configure(state="normal")
        widget.delete("1.0", "end")
        widget.insert("1.0", value)
        widget.configure(state="disabled")

    def _copy(self, value: str, success_text: str) -> None:
        self.clipboard_clear()
        self.clipboard_append(value)
        self.update_idletasks()
        self.set_status(success_text)

    def copy_activation_code(self) -> None:
        if not self.current_result:
            self.set_status("还没有可复制的授权码。")
            return
        self._copy(self.current_result.code, "激活码已复制。")

    def copy_customer_message(self) -> None:
        if not self.current_result:
            self.set_status("还没有可复制的客户消息。")
            return
        self._copy(self.current_result.customer_message, "完整客户消息已复制。")

    def save_single_txt(self) -> None:
        if not self.current_result:
            self.set_status("还没有可保存的授权结果。")
            return
        safe_customer = "".join(ch for ch in self.current_result.customer if ch not in r'\\/:*?"<>|').strip() or "客户"
        target = filedialog.asksaveasfilename(
            title="保存授权文件",
            initialdir=str(self.app_dir),
            initialfile=f"{safe_customer}-{self.current_result.license_id}.txt",
            defaultextension=".txt",
            filetypes=[("文本文件", "*.txt")],
        )
        if not target:
            return
        content = self.current_result.customer_message + "\n\n本地授权元数据：\n" + json.dumps(self.current_result.as_record(), ensure_ascii=False, indent=2)
        Path(target).write_text(content, encoding="utf-8-sig")
        self.set_status(f"授权文件已保存：{target}")

    def _parse_batch_lines(self) -> list[dict[str, str]]:
        rows: list[dict[str, str]] = []
        content = self.batch_input.get("1.0", "end").strip()
        for line_no, raw_line in enumerate(content.splitlines(), 1):
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [part.strip() for part in line.replace("\t", ",").replace("，", ",").split(",")]
            if len(parts) < 1:
                continue
            if len(parts) == 1:
                device = parts[0]
                customer = order = note = ""
            elif len(parts) == 2:
                device, customer = parts
                order = note = ""
            elif len(parts) == 3:
                device, customer, order = parts
                note = ""
            else:
                device, customer, order, note = parts[:4]
            rows.append({"line": str(line_no), "device": device, "customer": customer, "order_id": order, "note": note})
        return rows

    def generate_batch(self) -> None:
        try:
            key = self._require_key()
            plan = parse_plan_display(self.batch_plan_var.get())
            rows = self._parse_batch_lines()
            if not rows:
                raise LicenseError("请先粘贴至少一行用户数据")
            base_now = int(datetime.now(tz=CHINA_TZ).timestamp() * 1000)
            results: list[LicenseResult] = []
            errors: list[str] = []
            for index, row in enumerate(rows):
                try:
                    results.append(
                        generate_license(
                            key,
                            row["device"],
                            plan,
                            expire_date=self.batch_province_expire_var.get(),
                            exam=(self.batch_province_name_var.get() if plan == "province" else ("national" if plan == "gk" else "")),
                            customer=row["customer"],
                            order_id=row["order_id"],
                            note=row["note"],
                            now_ms=base_now + index,
                        )
                    )
                except LicenseError as exc:
                    errors.append(f"第 {row['line']} 行：{exc}")
            if results:
                self.records.append_many(results)
            self.batch_results = results
            self._show_batch_results(results)
            self.refresh_history()
            if errors:
                preview = "\n".join(errors[:12])
                if len(errors) > 12:
                    preview += f"\n……其余 {len(errors) - 12} 条错误未显示"
                messagebox.showwarning("部分记录未生成", f"成功 {len(results)} 条，失败 {len(errors)} 条。\n\n{preview}", parent=self)
            self.set_status(f"批量生成完成：成功 {len(results)} 条，失败 {len(errors)} 条。")
        except (LicenseError, OSError) as exc:
            messagebox.showerror("无法批量生成", str(exc), parent=self)
            self.set_status(str(exc))

    def _show_batch_results(self, results: list[LicenseResult]) -> None:
        for item in self.batch_tree.get_children():
            self.batch_tree.delete(item)
        for result in results:
            self.batch_tree.insert("", "end", values=(result.device, result.customer, result.label, result.expire_text, result.order_id, result.license_id))

    def copy_selected_batch(self) -> None:
        selection = self.batch_tree.selection()
        if not selection:
            self.set_status("请先选中一条生成结果。")
            return
        index = self.batch_tree.index(selection[0])
        if index >= len(self.batch_results):
            return
        self._copy(self.batch_results[index].code, "选中用户的激活码已复制。")

    def export_batch_csv(self) -> None:
        if not self.batch_results:
            self.set_status("当前没有可导出的批量结果。")
            return
        target = filedialog.asksaveasfilename(title="导出批量授权结果", initialdir=str(self.app_dir), initialfile="批量授权结果.csv", defaultextension=".csv", filetypes=[("CSV 文件", "*.csv")])
        if not target:
            return
        with Path(target).open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=RecordStore.FIELDS)
            writer.writeheader()
            writer.writerows([result.as_record() for result in self.batch_results])
        self.set_status(f"批量授权结果已导出：{target}")

    def import_batch_csv(self) -> None:
        target = filedialog.askopenfilename(title="导入用户 CSV", initialdir=str(self.app_dir), filetypes=[("CSV 文件", "*.csv"), ("所有文件", "*.*")])
        if not target:
            return
        try:
            with Path(target).open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            lines: list[str] = []
            for row in rows:
                device = row.get("device") or row.get("设备码") or ""
                customer = row.get("customer") or row.get("客户") or row.get("客户名称") or ""
                order_id = row.get("order_id") or row.get("订单号") or ""
                note = row.get("note") or row.get("备注") or ""
                if device:
                    lines.append(",".join([device, customer, order_id, note]))
            self.batch_input.delete("1.0", "end")
            self.batch_input.insert("1.0", "\n".join(lines) + ("\n" if lines else ""))
            self.set_status(f"已从 CSV 导入 {len(lines)} 条用户数据。")
        except (OSError, csv.Error) as exc:
            messagebox.showerror("导入失败", str(exc), parent=self)

    def clear_batch(self) -> None:
        self.batch_input.delete("1.0", "end")
        self.batch_results = []
        self._show_batch_results([])
        self.set_status("批量输入和结果已清空。")

    def refresh_history(self) -> None:
        try:
            self.history_rows = self.records.read_all()
        except (OSError, csv.Error) as exc:
            self.set_status(f"读取授权记录失败：{exc}")
            return
        query = self.history_search_var.get().strip().lower() if hasattr(self, "history_search_var") else ""
        rows = self.history_rows
        if query:
            rows = [row for row in rows if query in " ".join(str(value) for value in row.values()).lower()]
        self.history_view_rows = rows
        if hasattr(self, "history_tree"):
            for item in self.history_tree.get_children():
                self.history_tree.delete(item)
            for index, row in enumerate(reversed(rows)):
                self.history_tree.insert(
                    "",
                    "end",
                    iid=str(index),
                    values=(
                        row.get("generated_at", ""),
                        row.get("customer", ""),
                        row.get("device", ""),
                        row.get("plan_name", ""),
                        row.get("expires_at", ""),
                        row.get("order_id", ""),
                        row.get("license_id", ""),
                    ),
                )
            children = self.history_tree.get_children()
            if children:
                self.history_tree.selection_set(children[0])

    def _selected_history(self) -> dict[str, str] | None:
        selection = self.history_tree.selection()
        if not selection:
            return None
        try:
            reversed_index = int(selection[0])
            return self.history_view_rows[len(self.history_view_rows) - reversed_index - 1]
        except (ValueError, IndexError, AttributeError):
            return None

    def copy_history_code(self) -> None:
        row = self._selected_history()
        if not row:
            self.set_status("请先选中一条授权记录。")
            return
        self._copy(row.get("code", ""), f"已复制授权编号 {row.get('license_id', '')} 的激活码。")

    def show_history_detail(self, _event: Any = None) -> None:
        row = self._selected_history()
        if not row:
            return
        result = LicenseResult(
            label=row.get("plan_name", ""),
            plan=row.get("plan", ""),
            device=row.get("device", ""),
            license_id=row.get("license_id", ""),
            issued_at=0,
            expires_at=0,
            code=row.get("code", ""),
            customer=row.get("customer", ""),
            order_id=row.get("order_id", ""),
            note=row.get("note", ""),
        )
        detail = "\n".join(
            [
                f"客户：{result.customer or '-'}",
                f"订单号：{result.order_id or '-'}",
                f"设备码：{result.device}",
                f"套餐：{result.label}",
                f"到期时间：{row.get('expires_at', '')}",
                f"授权编号：{result.license_id}",
                "",
                "激活码：",
                result.code,
            ]
        )
        window = tk.Toplevel(self)
        window.title("授权记录详情")
        window.geometry("760x430")
        window.configure(bg=BG)
        window.transient(self)
        text = tk.Text(window, wrap="word", bg=CARD, fg=TEXT, relief="flat", padx=16, pady=14, font=("Microsoft YaHei UI", 10))
        text.pack(fill="both", expand=True, padx=16, pady=16)
        text.insert("1.0", detail)
        text.configure(state="disabled")
        self._button(window, "复制激活码", lambda: self._copy(result.code, "激活码已复制。"), primary=True).pack(pady=(0, 16))

    def export_history(self) -> None:
        target = filedialog.asksaveasfilename(title="导出授权记录备份", initialdir=str(self.app_dir), initialfile="授权记录备份.csv", defaultextension=".csv", filetypes=[("CSV 文件", "*.csv")])
        if not target:
            return
        try:
            self.records.export(target)
            self.set_status(f"授权记录已导出：{target}")
        except OSError as exc:
            messagebox.showerror("导出失败", str(exc), parent=self)

    def open_records_folder(self) -> None:
        self.records.ensure_dir()
        try:
            os.startfile(str(self.records.base_dir))  # type: ignore[attr-defined]
        except OSError as exc:
            messagebox.showerror("无法打开文件夹", str(exc), parent=self)

    def open_verify_dialog(self) -> None:
        window = tk.Toplevel(self)
        window.title("校验激活码")
        window.geometry("760x560")
        window.minsize(680, 480)
        window.configure(bg=BG)
        window.transient(self)
        card = self._card(window)
        card.pack(fill="both", expand=True, padx=16, pady=16)
        self._label(card, "校验激活码", size=14, bold=True).pack(anchor="w", padx=20, pady=(18, 4))
        self._subtitle(card, "可核对套餐、设备码、到期时间和签名是否有效。设备码可留空。").pack(anchor="w", padx=20, pady=(0, 12))
        device_var = tk.StringVar()
        self._label(card, "设备码（可选）", bold=True).pack(anchor="w", padx=20, pady=(0, 5))
        self._entry(card, device_var).pack(fill="x", padx=20, ipady=7)
        self._label(card, "激活码", bold=True).pack(anchor="w", padx=20, pady=(12, 5))
        code_text = tk.Text(card, height=7, wrap="char", bg="#F8FAFC", fg=TEXT, relief="flat", padx=10, pady=9, font=("Consolas", 9), highlightthickness=1, highlightbackground=BORDER)
        code_text.pack(fill="x", padx=20)
        output = tk.Text(card, height=9, wrap="word", bg=CARD, fg=TEXT, relief="flat", padx=10, pady=8, font=("Microsoft YaHei UI", 9))
        output.pack(fill="both", expand=True, padx=20, pady=(14, 8))
        output.configure(state="disabled")

        def run_verify() -> None:
            try:
                code = code_text.get("1.0", "end").strip()
                payload = verify_license(code, device_var.get())
                decoded = decode_license(code)
                details = "\n".join(
                    [
                        "校验结果：有效",
                        f"授权编号：{payload.get('lid', '-')}",
                        f"套餐：{PLANS.get(str(payload.get('plan')), {}).get('name', payload.get('plan', '-'))}",
                        f"设备码：{', '.join(payload.get('devices', []))}",
                        f"签发时间：{format_china_time(int(payload.get('iat') or 0))}",
                        f"到期时间：{format_china_time(int(payload.get('exp') or 0))}",
                        f"功能范围：{', '.join(payload.get('features', []))}",
                        f"原文版本：{decoded.get('v', '-')}",
                    ]
                )
                output.configure(state="normal", fg=SUCCESS)
                output.delete("1.0", "end")
                output.insert("1.0", details)
                output.configure(state="disabled")
            except LicenseError as exc:
                output.configure(state="normal", fg=DANGER)
                output.delete("1.0", "end")
                output.insert("1.0", f"校验结果：无效\n\n{exc}")
                output.configure(state="disabled")

        actions = tk.Frame(card, bg=CARD)
        actions.pack(fill="x", padx=20, pady=(0, 18))
        self._button(actions, "开始校验", run_verify, primary=True).pack(side="left")

        def clear_verify() -> None:
            code_text.delete("1.0", "end")
            output.configure(state="normal")
            output.delete("1.0", "end")
            output.configure(state="disabled")

        self._button(actions, "清空", clear_verify).pack(side="left", padx=6)

def run_self_test(report_path: Path | None = None) -> int:
    key_path = locate_private_key(app_directory())
    if not key_path:
        raise LicenseError("自检失败：未找到 private-key.json")
    report = self_test(key_path)
    if report_path:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=APP_NAME)
    parser.add_argument("--self-test", action="store_true", help="run signing and verification smoke tests")
    parser.add_argument("--report", default="", help="optional JSON report path for --self-test")
    args = parser.parse_args(argv)
    set_windows_dpi_awareness()
    if args.self_test:
        try:
            return run_self_test(Path(args.report) if args.report else None)
        except Exception as exc:  # noqa: BLE001 - CLI exit path
            if args.report:
                Path(args.report).write_text(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False, indent=2), encoding="utf-8")
            return 1
    app = LicenseAdminApp()
    app.refresh_history()
    app.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
