#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import gzip
import hashlib
import hmac
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import shutil
import ssl
import sqlite3
import threading
import time
from collections import defaultdict, deque
from contextlib import closing, contextmanager
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

PASSCODE_PATTERN = re.compile(r"^(?:[0-9]{4}|[0-9]{6})$")
PHONE_LAST4_PATTERN = re.compile(r"^[0-9]{4}$")
THEMES = {"rose", "mint", "sky", "lilac", "peach"}
FONT_STYLES = {"system", "serif", "handwriting", "humanist", "cute", "light"}
SUPPORTED_LANGUAGES = {"zh-CN", "zh-HK", "zh-TW", "ja", "en", "ko"}
WEIGHT_UNITS = {"kg", "jin", "lb", "st"}
DEFAULT_LANGUAGE = "zh-CN"
DEFAULT_WEIGHT_UNIT = "kg"
TARGET_PLAN_DAYS = 84
CALORIES_PER_KG = 7700
AI_DAILY_LIMIT = 10
MAX_LOCAL_SYNC_RECORDS = 5000
ARCHIVED_ACCOUNT_RETENTION_DAYS = 30
DEFAULT_SNAPSHOT_RETENTION_DAYS = 365
SNAPSHOT_ID_PATTERN = re.compile(
    r"^wcal-(?P<date>\d{4}-\d{2}-\d{2})(?:T(?P<time>\d{6,12}))?-(?P<kind>daily|manual|pre-restore)\.sqlite3\.gz$"
)
AI_PROMPT_INSTRUCTIONS = {
    "zh-CN": "你是谨慎简洁的健康生活方式助手。请用简体中文回答。根据用户主动提供的数据，给出一般性的状态评价、饮食、运动和睡眠建议。若包含目标体重、目标体脂和每日热量差，请围绕目标节奏给建议；若节奏过激进，优先提醒放慢。不做诊断，不推荐药物、极端节食或危险训练。数据不足或异常时，提醒用户咨询医生或注册营养师。",
    "zh-HK": "你是謹慎簡潔的健康生活方式助手。請用香港繁體中文回答。根據用戶主動提供的資料，提供一般狀態評價、飲食、運動和睡眠建議。若包含目標體重、目標體脂和每日熱量差，請圍繞目標節奏給建議；若節奏過急，優先提醒放慢。不作診斷，不建議藥物、極端節食或危險訓練。資料不足或異常時，提醒用戶諮詢醫生或註冊營養師。",
    "zh-TW": "你是謹慎簡潔的健康生活助手。請用台灣繁體中文回答。根據使用者主動提供的資料，提供一般狀態評價、飲食、運動與睡眠建議。若包含目標體重、目標體脂與每日熱量差，請圍繞目標節奏給建議；若節奏過於激進，優先提醒放慢。不作診斷，不建議藥物、極端節食或危險訓練。資料不足或異常時，提醒使用者諮詢醫師或營養師。",
    "ja": "あなたは慎重で簡潔な生活習慣アシスタントです。自然な日本語で回答してください。ユーザーが自発的に提供したデータから、一般的な現状評価、食事、運動、睡眠のヒントを作成します。目標体重、目標体脂肪率、1日のカロリー差がある場合は、そのペースに沿って助言し、無理が大きい場合はペースを落とす提案を優先してください。診断、薬の推奨、極端な食事制限、危険なトレーニングは行わないでください。データが不十分または異常な場合は、医師や管理栄養士への相談を勧めてください。",
    "en": "You are a cautious, concise lifestyle assistant. Respond in natural English. Use data supplied voluntarily by the user to offer a general current-state evaluation plus food, exercise, and sleep suggestions. If target weight, target body fat, and daily calorie change are present, tailor advice to that pace; if it is aggressive, prioritize a safer slower pace. Do not diagnose, recommend medication, extreme dieting, or dangerous training. If data is insufficient or unusual, recommend consulting a doctor or registered dietitian.",
    "ko": "당신은 신중하고 간결한 생활 습관 도우미입니다。자연스러운 한국어로 답하세요。사용자가 자발적으로 제공한 데이터를 바탕으로 일반적인 현재 상태 평가、식사、운동、수면 제안을 제공하세요。목표 체중、목표 체지방률、하루 칼로리 차이가 있으면 그 속도에 맞춰 조언하되、무리한 속도라면 더 안전하게 늦추는 제안을 우선하세요。진단、약물 권장、극단적인 식이요법、위험한 훈련은 제안하지 마세요。데이터가 부족하거나 이상하면 의사나 영양사와 상담하도록 안내하세요。",
}
ERROR_MESSAGES = {
    "zh-HK": {"BAD_REQUEST": "請檢查輸入內容後再試", "PASSCODE_EXISTS": "這個密碼已有帳戶", "INVALID_CREDENTIALS": "密碼不正確", "PHONE_LAST4_REQUIRED": "請輸入手機號碼後四位", "INVALID_PHONE_LAST4": "手機號碼後四位不正確", "UNAUTHORIZED": "請先登入", "FORBIDDEN": "沒有權限完成此操作", "CONFLICT": "資料狀態已變更，請重試", "RATE_LIMITED": "嘗試次數太多，請稍後再試", "AI_DAILY_LIMIT": "今日已完成 10 次 AI 分析，明日再來看看。", "AI_UNAVAILABLE": "AI 分析暫時未能完成，請稍後再試", "INTERNAL_ERROR": "服務暫時不可用"},
    "zh-TW": {"BAD_REQUEST": "請檢查輸入內容後再試", "PASSCODE_EXISTS": "這個密碼已有帳號", "INVALID_CREDENTIALS": "密碼不正確", "PHONE_LAST4_REQUIRED": "請輸入手機號碼後四位", "INVALID_PHONE_LAST4": "手機號碼後四位不正確", "UNAUTHORIZED": "請先登入", "FORBIDDEN": "沒有權限完成此操作", "CONFLICT": "資料狀態已變更，請重試", "RATE_LIMITED": "嘗試次數太多，請稍後再試", "AI_DAILY_LIMIT": "今天已完成 10 次 AI 分析，明天再來看看。", "AI_UNAVAILABLE": "AI 分析暫時未完成，請稍後再試", "INTERNAL_ERROR": "服務暫時無法使用"},
    "ja": {"BAD_REQUEST": "入力内容を確認してもう一度お試しください", "PASSCODE_EXISTS": "このパスコードは使用済みです", "INVALID_CREDENTIALS": "パスコードが正しくありません", "PHONE_LAST4_REQUIRED": "電話番号の下4桁を入力してください", "INVALID_PHONE_LAST4": "電話番号の下4桁が正しくありません", "UNAUTHORIZED": "先にログインしてください", "FORBIDDEN": "この操作を行う権限がありません", "CONFLICT": "データが変更されました。もう一度お試しください", "RATE_LIMITED": "試行回数が多すぎます。後でお試しください", "AI_DAILY_LIMIT": "本日のAI分析は10回に達しました。明日もう一度お試しください。", "AI_UNAVAILABLE": "AI分析を完了できませんでした。後でお試しください", "INTERNAL_ERROR": "サービスを一時的に利用できません"},
    "en": {"BAD_REQUEST": "Check the information and try again.", "PASSCODE_EXISTS": "An account already uses this passcode.", "INVALID_CREDENTIALS": "The passcode is incorrect.", "PHONE_LAST4_REQUIRED": "Enter the last four digits of the phone number.", "INVALID_PHONE_LAST4": "The last four digits do not match.", "UNAUTHORIZED": "Please sign in first.", "FORBIDDEN": "You do not have permission to do that.", "CONFLICT": "The data changed. Please try again.", "RATE_LIMITED": "Too many attempts. Please try again later.", "AI_DAILY_LIMIT": "You have reached today's limit of 10 AI analyses. Try again tomorrow.", "AI_UNAVAILABLE": "AI analysis could not be completed. Please try again later.", "INTERNAL_ERROR": "The service is temporarily unavailable."},
    "ko": {"BAD_REQUEST": "입력 내용을 확인하고 다시 시도하세요", "PASSCODE_EXISTS": "이 암호는 이미 사용 중입니다", "INVALID_CREDENTIALS": "암호가 올바르지 않습니다", "PHONE_LAST4_REQUIRED": "휴대전화 번호 뒤 네 자리를 입력하세요", "INVALID_PHONE_LAST4": "휴대전화 번호 뒤 네 자리가 일치하지 않습니다", "UNAUTHORIZED": "먼저 로그인하세요", "FORBIDDEN": "이 작업을 할 권한이 없습니다", "CONFLICT": "데이터가 변경되었습니다. 다시 시도하세요", "RATE_LIMITED": "시도 횟수가 너무 많습니다. 잠시 후 다시 시도하세요", "AI_DAILY_LIMIT": "오늘 AI 분석 10회를 모두 사용했습니다. 내일 다시 시도하세요.", "AI_UNAVAILABLE": "AI 분석을 완료하지 못했습니다. 잠시 후 다시 시도하세요", "INTERNAL_ERROR": "서비스를 잠시 사용할 수 없습니다"},
}
MAX_BODY_BYTES = 1024 * 1024
SESSION_DAYS = 365
ADMIN_SESSION_HOURS = 12
PBKDF2_ITERATIONS = 210_000
SHANGHAI = ZoneInfo("Asia/Shanghai")
GEOLOCATION_SUCCESS_TTL = timedelta(days=30)
GEOLOCATION_FAILURE_TTL = timedelta(hours=1)
MAX_GEOLOCATION_RESPONSE_BYTES = 64 * 1024
MAX_AI_RESPONSE_BYTES = 128 * 1024
MAX_AI_REPORT_BYTES = 24 * 1024
DEFAULT_ARK_MODEL = "doubao-seed-2-0-mini-260428"
ANALYTICS_EVENT_TYPES = {"page_view", "impression", "click"}
MAX_ANALYTICS_BATCH_SIZE = 80
ANALYTICS_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,95}$")


class AppError(Exception):
    status = HTTPStatus.BAD_REQUEST
    code = "BAD_REQUEST"

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class DuplicatePasscode(AppError):
    status = HTTPStatus.CONFLICT
    code = "PASSCODE_EXISTS"


class InvalidCredentials(AppError):
    status = HTTPStatus.UNAUTHORIZED
    code = "INVALID_CREDENTIALS"


class PhoneLast4Required(AppError):
    status = HTTPStatus.UNAUTHORIZED
    code = "PHONE_LAST4_REQUIRED"


class InvalidPhoneLast4(AppError):
    status = HTTPStatus.UNAUTHORIZED
    code = "INVALID_PHONE_LAST4"


class Unauthorized(AppError):
    status = HTTPStatus.UNAUTHORIZED
    code = "UNAUTHORIZED"


class Forbidden(AppError):
    status = HTTPStatus.FORBIDDEN
    code = "FORBIDDEN"


class Conflict(AppError):
    status = HTTPStatus.CONFLICT
    code = "CONFLICT"


class RateLimited(AppError):
    status = HTTPStatus.TOO_MANY_REQUESTS
    code = "RATE_LIMITED"


class AiDailyLimit(AppError):
    status = HTTPStatus.TOO_MANY_REQUESTS
    code = "AI_DAILY_LIMIT"


class UpstreamUnavailable(AppError):
    status = HTTPStatus.BAD_GATEWAY
    code = "AI_UNAVAILABLE"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat(timespec="seconds")


def local_today() -> date:
    return datetime.now(SHANGHAI).date()


def normalize_ip(value: object) -> str:
    if not isinstance(value, str):
        return "unknown"
    candidate = value.split(",", 1)[0].strip()
    try:
        return ipaddress.ip_address(candidate).compressed
    except ValueError:
        return "unknown"


def localize_network_label(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    network = value.strip()
    if not network:
        return None
    normalized = network.casefold()
    carrier_labels = (
        (("china mobile", "cmcc"), "中国移动"),
        (("china unicom",), "中国联通"),
        (("china telecom", "chinanet"), "中国电信"),
        (("china broadcasting network", "cbn"), "中国广电"),
        (("cernet", "china education and research network"), "中国教育和科研计算机网"),
    )
    for aliases, label in carrier_labels:
        if any(alias in normalized for alias in aliases):
            return label
    connection_labels = {
        "mobile": "移动网络",
        "cellular": "蜂窝网络",
        "broadband": "宽带网络",
        "cable/dsl": "宽带网络",
        "wifi": "无线网络",
        "wireless": "无线网络",
        "corporate": "企业网络",
        "hosting": "托管网络",
        "vpn": "虚拟专用网络",
        "proxy": "代理网络",
    }
    return connection_labels.get(normalized, network)


class GeoLocator:
    def __init__(self, endpoint_template: str | None, timeout_seconds: float = 2.5):
        self.endpoint_template = (endpoint_template or "").strip()
        self.timeout_seconds = timeout_seconds
        default_paths = ssl.get_default_verify_paths()
        fallback_ca_files = (
            default_paths.cafile,
            "/etc/ssl/cert.pem",
            "/etc/ssl/certs/ca-certificates.crt",
        )
        ca_file = next(
            (path for path in fallback_ca_files if path and Path(path).is_file()),
            None,
        )
        self.ssl_context = ssl.create_default_context(cafile=ca_file)

    def locate(self, client_ip: str) -> dict[str, str | None]:
        normalized = normalize_ip(client_ip)
        if normalized == "unknown":
            return {}
        address = ipaddress.ip_address(normalized)
        if not address.is_global:
            return {
                "country_code": None,
                "country": "本地或保留地址",
                "region": None,
                "city": None,
                "network": None,
            }
        if not self.endpoint_template:
            return {}

        try:
            url = self.endpoint_template.format(ip=quote(normalized, safe=":"))
            request = Request(
                url,
                headers={"Accept": "application/json", "User-Agent": "WeightCalendar/1.0"},
            )
            with urlopen(
                request,
                timeout=self.timeout_seconds,
                context=self.ssl_context,
            ) as response:
                raw = response.read(MAX_GEOLOCATION_RESPONSE_BYTES + 1)
            if len(raw) > MAX_GEOLOCATION_RESPONSE_BYTES:
                return {}
            payload = json.loads(raw.decode("utf-8"))
            if not isinstance(payload, dict) or payload.get("success") is not True:
                return {}
            connection = payload.get("connection")
            if not isinstance(connection, dict):
                connection = {}

            def text_value(value: object, maximum: int = 120) -> str | None:
                if not isinstance(value, str):
                    return None
                cleaned = value.strip()
                return cleaned[:maximum] or None

            country_code = text_value(payload.get("country_code"), 8)
            if country_code is not None:
                country_code = country_code.upper()
                if re.fullmatch(r"[A-Z]{2}", country_code) is None:
                    country_code = None

            return {
                "country_code": country_code,
                "country": text_value(payload.get("country")),
                "region": text_value(payload.get("region")),
                "city": text_value(payload.get("city")),
                "network": text_value(connection.get("isp") or connection.get("org"), 160),
            }
        except (KeyError, OSError, TimeoutError, ValueError, UnicodeDecodeError, json.JSONDecodeError):
            return {}


def validate_height_cm(height_cm: object) -> int:
    if isinstance(height_cm, bool) or not isinstance(height_cm, (int, float)):
        raise AppError("身高格式不正确")
    rounded_height = round(float(height_cm))
    if rounded_height < 120 or rounded_height > 230:
        raise AppError("身高需在 120 到 230 cm 之间")
    return rounded_height


def validate_body_fat_percent(body_fat_percent: object) -> float:
    if isinstance(body_fat_percent, bool) or not isinstance(body_fat_percent, (int, float)):
        raise AppError("体脂率格式不正确")
    rounded_body_fat = round(float(body_fat_percent), 1)
    if rounded_body_fat < 3 or rounded_body_fat > 60:
        raise AppError("体脂率需在 3% 到 60% 之间")
    return rounded_body_fat


def validate_health_profile(height_cm: object, body_fat_percent: object) -> tuple[int, float]:
    rounded_height = validate_height_cm(height_cm)
    rounded_body_fat = validate_body_fat_percent(body_fat_percent)
    return rounded_height, rounded_body_fat


def validate_language(value: object) -> str:
    if not isinstance(value, str) or value not in SUPPORTED_LANGUAGES:
        raise AppError("不支持该语言")
    return value


def validate_weight_unit(value: object) -> str:
    if not isinstance(value, str) or value not in WEIGHT_UNITS:
        raise AppError("不支持该体重单位")
    return value


def normalize_request_language(value: object) -> str:
    if not isinstance(value, str):
        return DEFAULT_LANGUAGE
    candidate = value.split(",", 1)[0].split(";", 1)[0].strip()
    if candidate in SUPPORTED_LANGUAGES:
        return candidate
    lowered = candidate.lower()
    if lowered.startswith("zh-hk") or lowered.startswith("zh-hant-hk"):
        return "zh-HK"
    if lowered.startswith("zh-tw") or lowered.startswith("zh-hant"):
        return "zh-TW"
    if lowered.startswith("zh"):
        return "zh-CN"
    if lowered.startswith("ja"):
        return "ja"
    if lowered.startswith("ko"):
        return "ko"
    if lowered.startswith("en"):
        return "en"
    return DEFAULT_LANGUAGE


class DoubaoAnalyzer:
    def __init__(self, api_key: str | None, model: str = DEFAULT_ARK_MODEL, timeout_seconds: float = 15):
        self.api_key = (api_key or "").strip()
        self.model = model.strip() or DEFAULT_ARK_MODEL
        self.timeout_seconds = timeout_seconds
        default_paths = ssl.get_default_verify_paths()
        fallback_ca_files = (
            default_paths.cafile,
            "/etc/ssl/cert.pem",
            "/etc/ssl/certs/ca-certificates.crt",
        )
        ca_file = next(
            (path for path in fallback_ca_files if path and Path(path).is_file()),
            None,
        )
        self.ssl_context = ssl.create_default_context(cafile=ca_file)

    @staticmethod
    def _clean_text(value: object, maximum: int = 90) -> str:
        if not isinstance(value, str):
            return ""
        return " ".join(value.strip().split())[:maximum]

    def _normalize_analysis(self, value: object) -> dict:
        if not isinstance(value, dict):
            raise ValueError("analysis must be an object")
        result = {"summary": self._clean_text(value.get("summary"), 60)}
        if not result["summary"]:
            raise ValueError("summary cannot be empty")
        status = self._clean_text(value.get("status"), 90)
        if status:
            result["status"] = status
        for key in ("diet", "exercise", "sleep"):
            items = value.get(key)
            if not isinstance(items, list):
                raise ValueError(f"{key} must be a list")
            cleaned = [self._clean_text(item, 80) for item in items[:3]]
            result[key] = [item for item in cleaned if item]
            if not result[key]:
                raise ValueError(f"{key} cannot be empty")
        return result

    @staticmethod
    def build_prompt(
        health_context: dict,
        height_cm: int,
        body_fat_percent: float,
        language: str,
    ) -> str:
        language = validate_language(language)
        instructions = AI_PROMPT_INSTRUCTIONS[language]
        schema = (
            'Return only one JSON object with this exact structure: '
            '{"summary":"overall observation","status":"current state evaluation",'
            '"diet":["suggestion 1","suggestion 2"],'
            '"exercise":["suggestion 1","suggestion 2"],"sleep":["suggestion 1","suggestion 2"]}. '
            'Do not use Markdown or add extra text. Keep the summary, status, and each suggestion concise, gentle, specific, and practical. '
            'If User data contains a goal object, use dailyCalorieChangeKcal and intensity as pacing references; do not treat them as medical prescriptions.'
        )
        user_data = json.dumps(health_context, ensure_ascii=False, separators=(",", ":"))
        return (
            f"{instructions} {schema}\n"
            f"User data: height {height_cm} cm, estimated body fat {body_fat_percent}%, "
            f"weight record summary {user_data}"
        )

    def analyze(
        self,
        health_context: dict,
        height_cm: object,
        body_fat_percent: object,
        language: str = DEFAULT_LANGUAGE,
    ) -> dict:
        if not self.api_key:
            raise UpstreamUnavailable("AI 分析暂未配置")
        height_cm, body_fat_percent = validate_health_profile(height_cm, body_fat_percent)
        prompt = self.build_prompt(health_context, height_cm, body_fat_percent, language)
        body = json.dumps(
            {
                "model": self.model,
                "input": prompt,
                "thinking": {"type": "disabled"},
                "max_output_tokens": 620,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        request = Request(
            "https://ark.cn-beijing.volces.com/api/v3/responses",
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "WeightCalendar/1.0",
            },
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds, context=self.ssl_context) as response:
                raw = response.read(MAX_AI_RESPONSE_BYTES + 1)
            if len(raw) > MAX_AI_RESPONSE_BYTES:
                raise ValueError("AI response too large")
            payload = json.loads(raw.decode("utf-8"))
            texts = [
                content.get("text", "")
                for output in payload.get("output", [])
                if isinstance(output, dict) and output.get("type") == "message"
                for content in output.get("content", [])
                if isinstance(content, dict) and content.get("type") == "output_text"
            ]
            text = "".join(texts).strip()
            if text.startswith("```"):
                text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
            analysis = self._normalize_analysis(json.loads(text))
            return {
                "analysis": analysis,
                "model": self.model,
                "heightCm": height_cm,
                "bodyFatPercent": body_fat_percent,
                "goal": health_context.get("goal"),
            }
        except UpstreamUnavailable:
            raise
        except (KeyError, OSError, TimeoutError, ValueError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise UpstreamUnavailable("AI 分析暂时没有完成，请稍后再试") from exc


def validate_passcode(passcode: object) -> str:
    if not isinstance(passcode, str) or not PASSCODE_PATTERN.fullmatch(passcode):
        raise AppError("密码必须是四位或六位数字")
    return passcode


def validate_phone_last4(phone_last4: object) -> str:
    if not isinstance(phone_last4, str) or not PHONE_LAST4_PATTERN.fullmatch(phone_last4):
        raise AppError("请输入手机号后四位")
    return phone_last4


def validate_display_name(value: object, *, required: bool = False) -> str | None:
    if value is None:
        if required:
            raise AppError("请输入昵称")
        return None
    if not isinstance(value, str):
        raise AppError("名字格式不正确")
    display_name = value.strip()
    if not display_name:
        if required:
            raise AppError("请输入昵称")
        return None
    if len(display_name) > 10:
        raise AppError("名字最多 10 个字符")
    if any(ord(character) < 32 or ord(character) == 127 for character in display_name):
        raise AppError("名字不能包含控制字符")
    return display_name


def validate_font_style(value: object) -> str:
    if not isinstance(value, str) or value not in FONT_STYLES:
        raise AppError("字体样式不存在")
    return value


def validate_sound_enabled(value: object) -> bool:
    if not isinstance(value, bool):
        raise AppError("音效设置格式不正确")
    return value


def validate_date(value: object) -> str:
    if not isinstance(value, str):
        raise AppError("日期格式不正确")
    try:
        parsed = date.fromisoformat(value)
    except ValueError as exc:
        raise AppError("日期格式不正确") from exc
    if parsed > local_today():
        raise AppError("不能记录未来日期")
    return parsed.isoformat()


def validate_weight(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise AppError("体重格式不正确")
    if value < 100 or value > 999_000:
        raise AppError("体重需在 0.1 到 999.0 kg 之间")
    return value


def validate_analytics_key(value: object, label: str, *, required: bool = True) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str):
        raise AppError(f"{label}格式不正确")
    key = value.strip().lower()
    if not ANALYTICS_KEY_PATTERN.fullmatch(key):
        raise AppError(f"{label}格式不正确")
    return key


def validate_analytics_label(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise AppError("功能名称格式不正确")
    label = " ".join(value.strip().split())[:80]
    if any(ord(character) < 32 or ord(character) == 127 for character in label):
        raise AppError("功能名称格式不正确")
    return label or None


def validate_analytics_events(value: object) -> list[dict]:
    if not isinstance(value, list) or not value or len(value) > MAX_ANALYTICS_BATCH_SIZE:
        raise AppError("行为事件数量不正确")
    validated: list[dict] = []
    for raw_event in value:
        if not isinstance(raw_event, dict):
            raise AppError("行为事件格式不正确")
        event_type = raw_event.get("eventType")
        if event_type not in ANALYTICS_EVENT_TYPES:
            raise AppError("行为事件类型不正确")
        element_key = validate_analytics_key(
            raw_event.get("elementKey"), "功能编号", required=event_type != "page_view"
        )
        if event_type != "page_view" and element_key is None:
            raise AppError("功能编号格式不正确")
        validated.append(
            {
                "eventType": event_type,
                "pageKey": validate_analytics_key(raw_event.get("pageKey"), "页面编号"),
                "pageViewId": validate_analytics_key(raw_event.get("pageViewId"), "页面访问编号"),
                "elementKey": element_key if event_type != "page_view" else None,
                "elementLabel": validate_analytics_label(raw_event.get("elementLabel")),
                "targetPage": validate_analytics_key(
                    raw_event.get("targetPage"), "目标页面", required=False
                ),
            }
        )
    return validated


def validate_optional_weight(value: object) -> int | None:
    if value is None:
        return None
    return validate_weight(value)


def validate_optional_height_cm(value: object) -> int | None:
    if value is None:
        return None
    return validate_height_cm(value)


def validate_optional_body_fat_percent(value: object) -> float | None:
    if value is None:
        return None
    return validate_body_fat_percent(value)


def validate_goal_profile(target_weight_grams: object, target_body_fat_percent: object) -> tuple[int, float]:
    target_weight = validate_optional_weight(target_weight_grams)
    target_body_fat = validate_optional_body_fat_percent(target_body_fat_percent)
    if target_weight is None:
        raise AppError("请设置目标体重")
    if target_body_fat is None:
        raise AppError("请设置目标体脂率")
    return target_weight, target_body_fat


def validate_client_uid(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise AppError("用户编号格式不正确")
    client_uid = value.strip()
    if not re.fullmatch(r"[A-Za-z0-9._:-]{8,96}", client_uid):
        raise AppError("用户编号格式不正确")
    return client_uid


def validate_optional_timestamp(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise AppError("时间格式不正确")
    candidate = value.strip()
    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AppError("时间格式不正确") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat(timespec="seconds")


def validate_optional_signature(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise AppError("报告标识格式不正确")
    signature = value.strip()
    if len(signature) > 240 or any(ord(character) < 32 for character in signature):
        raise AppError("报告标识格式不正确")
    return signature or None


def sanitize_cached_ai_report(value: object) -> dict | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise AppError("AI 报告格式不正确")
    raw = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if len(raw.encode("utf-8")) > MAX_AI_REPORT_BYTES:
        raise AppError("AI 报告内容过大")
    report = json.loads(raw)
    if not isinstance(report.get("analysis"), dict):
        raise AppError("AI 报告格式不正确")
    return report


def timestamp_sort_value(value: object) -> datetime:
    if not isinstance(value, str):
        return utc_now()
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return utc_now()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def sanitize_client_records(value: object) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise AppError("体重记录格式不正确")
    if len(value) > MAX_LOCAL_SYNC_RECORDS:
        raise AppError("体重记录太多，请先导出后分批处理")

    deduped: dict[str, dict] = {}
    for item in value:
        if not isinstance(item, dict):
            raise AppError("体重记录格式不正确")
        record_date = validate_date(item.get("date"))
        updated_at = validate_optional_timestamp(item.get("updatedAt")) or iso_now()
        deduped[record_date] = {
            "date": record_date,
            "weightGrams": validate_weight(item.get("weightGrams")),
            "updatedAt": updated_at,
        }
    return [deduped[key] for key in sorted(deduped)]


def build_goal_context(
    records: list[dict],
    current_body_fat_percent: float | None,
    target_weight_grams: int | None,
    target_body_fat_percent: float | None,
) -> dict | None:
    if not records or target_weight_grams is None or target_body_fat_percent is None:
        return None
    latest_weight_grams = records[-1]["weightGrams"]
    current_weight_kg = latest_weight_grams / 1000
    target_weight_kg = target_weight_grams / 1000
    weight_change_kg = target_weight_kg - current_weight_kg
    total_calorie_change_kcal = round(weight_change_kg * CALORIES_PER_KG)
    daily_calorie_change_kcal = round(total_calorie_change_kcal / TARGET_PLAN_DAYS)
    daily_abs = abs(daily_calorie_change_kcal)
    if daily_calorie_change_kcal <= -25:
        direction = "deficit"
    elif daily_calorie_change_kcal >= 25:
        direction = "surplus"
    else:
        direction = "maintain"
    if daily_abs >= 750:
        intensity = "aggressive"
    elif daily_abs >= 500:
        intensity = "high"
    elif daily_abs >= 250:
        intensity = "moderate"
    else:
        intensity = "gentle"

    body_fat_change_percent = None
    fat_mass_change_kg = None
    if current_body_fat_percent is not None:
        body_fat_change_percent = round(target_body_fat_percent - current_body_fat_percent, 1)
        current_fat_mass_kg = current_weight_kg * current_body_fat_percent / 100
        target_fat_mass_kg = target_weight_kg * target_body_fat_percent / 100
        fat_mass_change_kg = round(target_fat_mass_kg - current_fat_mass_kg, 1)

    return {
        "planDays": TARGET_PLAN_DAYS,
        "caloriesPerKg": CALORIES_PER_KG,
        "currentWeightKg": round(current_weight_kg, 1),
        "targetWeightKg": round(target_weight_kg, 1),
        "weightChangeKg": round(weight_change_kg, 1),
        "currentBodyFatPercent": current_body_fat_percent,
        "targetBodyFatPercent": target_body_fat_percent,
        "bodyFatChangePercent": body_fat_change_percent,
        "fatMassChangeKg": fat_mass_change_kg,
        "totalCalorieChangeKcal": total_calorie_change_kcal,
        "dailyCalorieChangeKcal": daily_calorie_change_kcal,
        "dailyCalorieAbsKcal": daily_abs,
        "direction": direction,
        "intensity": intensity,
    }


def build_health_context(
    records: list[dict],
    *,
    total_record_count: int | None = None,
    current_body_fat_percent: float | None = None,
    target_weight_grams: int | None = None,
    target_body_fat_percent: float | None = None,
) -> dict:
    recent_records = records[-60:]
    if not recent_records:
        return {
            "recordCount": total_record_count or 0,
            "latestWeightKg": None,
            "recentChangeKg": None,
            "records": [],
            "goal": None,
        }
    first_weight = recent_records[0]["weightGrams"]
    latest_weight = recent_records[-1]["weightGrams"]
    return {
        "recordCount": total_record_count if total_record_count is not None else len(records),
        "latestWeightKg": round(latest_weight / 1000, 1),
        "recentChangeKg": round((latest_weight - first_weight) / 1000, 1),
        "records": [
            {"date": record["date"], "weightKg": round(record["weightGrams"] / 1000, 1)}
            for record in recent_records[-14:]
        ],
        "goal": build_goal_context(
            recent_records,
            current_body_fat_percent,
            target_weight_grams,
            target_body_fat_percent,
        ),
    }


class Database:
    def __init__(
        self,
        path: str | Path,
        secret: str,
        snapshot_dir: str | Path | None = None,
        snapshot_retention_days: int = DEFAULT_SNAPSHOT_RETENTION_DAYS,
    ):
        if len(secret) < 32:
            raise RuntimeError("WCAL_SECRET must contain at least 32 characters")
        if snapshot_retention_days < 1:
            raise RuntimeError("WCAL_SNAPSHOT_RETENTION_DAYS must be at least 1")
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.snapshot_dir = Path(snapshot_dir) if snapshot_dir else self.path.parent / "snapshots"
        self.snapshot_retention_days = snapshot_retention_days
        self.secret = secret.encode("utf-8")
        self._initialize()

    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_uid TEXT UNIQUE,
                    passcode_lookup TEXT NOT NULL UNIQUE,
                    passcode_salt TEXT NOT NULL,
                    passcode_hash TEXT NOT NULL,
                    passcode_ciphertext TEXT,
                    phone_last4_salt TEXT,
                    phone_last4_hash TEXT,
                    phone_last4_ciphertext TEXT,
                    display_name TEXT,
                    theme TEXT NOT NULL DEFAULT 'rose',
                    font_style TEXT NOT NULL DEFAULT 'system',
                    sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0, 1)),
                    language TEXT NOT NULL DEFAULT 'zh-CN' CHECK (language IN ('zh-CN', 'zh-HK', 'zh-TW', 'ja', 'en', 'ko')),
                    unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'jin', 'lb', 'st')),
                    height_cm INTEGER,
                    body_fat_percent REAL,
                    target_weight_grams INTEGER,
                    target_body_fat_percent REAL,
                    ai_report_json TEXT,
                    ai_report_signature TEXT,
                    ai_report_generated_at TEXT,
                    initial_weight_grams INTEGER,
                    initial_date TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK (theme IN ('rose', 'mint', 'sky', 'lilac', 'peach')),
                    CHECK (font_style IN ('system', 'serif', 'handwriting', 'humanist', 'cute', 'light')),
                    CHECK ((phone_last4_salt IS NULL AND phone_last4_hash IS NULL) OR (phone_last4_salt IS NOT NULL AND phone_last4_hash IS NOT NULL)),
                    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 10),
                    CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 230),
                    CHECK (body_fat_percent IS NULL OR body_fat_percent BETWEEN 3 AND 60),
                    CHECK (target_weight_grams IS NULL OR target_weight_grams BETWEEN 100 AND 999000),
                    CHECK (target_body_fat_percent IS NULL OR target_body_fat_percent BETWEEN 3 AND 60),
                    CHECK (initial_weight_grams IS NULL OR initial_weight_grams BETWEEN 100 AND 999000)
                );

                CREATE TABLE IF NOT EXISTS weight_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    record_date TEXT NOT NULL,
                    weight_grams INTEGER NOT NULL CHECK (weight_grams BETWEEN 100 AND 999000),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (user_id, record_date)
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS archived_accounts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    original_user_id INTEGER NOT NULL,
                    client_uid TEXT,
                    display_name TEXT,
                    passcode_ciphertext TEXT,
                    phone_last4_salt TEXT,
                    phone_last4_hash TEXT,
                    phone_last4_ciphertext TEXT,
                    theme TEXT NOT NULL,
                    font_style TEXT NOT NULL DEFAULT 'system',
                    sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0, 1)),
                    language TEXT NOT NULL DEFAULT 'zh-CN' CHECK (language IN ('zh-CN', 'zh-HK', 'zh-TW', 'ja', 'en', 'ko')),
                    unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'jin', 'lb', 'st')),
                    height_cm INTEGER,
                    body_fat_percent REAL,
                    target_weight_grams INTEGER,
                    target_body_fat_percent REAL,
                    ai_report_json TEXT,
                    ai_report_signature TEXT,
                    ai_report_generated_at TEXT,
                    initial_weight_grams INTEGER,
                    initial_date TEXT,
                    account_created_at TEXT NOT NULL,
                    account_updated_at TEXT NOT NULL,
                    archived_at TEXT NOT NULL,
                    records_json TEXT NOT NULL,
                    record_count INTEGER NOT NULL
                );

                CREATE TABLE IF NOT EXISTS admin_sessions (
                    token_hash TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS access_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    visitor_hash TEXT NOT NULL,
                    ip_address TEXT,
                    path TEXT NOT NULL,
                    user_id INTEGER,
                    user_agent TEXT,
                    country_code TEXT,
                    country TEXT,
                    region TEXT,
                    city TEXT,
                    network TEXT,
                    occurred_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS local_clients (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    client_uid TEXT NOT NULL UNIQUE,
                    display_name TEXT,
                    theme TEXT NOT NULL DEFAULT 'rose',
                    font_style TEXT NOT NULL DEFAULT 'system',
                    sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0, 1)),
                    language TEXT NOT NULL DEFAULT 'zh-CN',
                    unit TEXT NOT NULL DEFAULT 'kg',
                    height_cm INTEGER,
                    body_fat_percent REAL,
                    target_weight_grams INTEGER,
                    target_body_fat_percent REAL,
                    ai_report_json TEXT,
                    initial_weight_grams INTEGER,
                    initial_date TEXT,
                    records_json TEXT NOT NULL DEFAULT '[]',
                    record_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS local_client_links (
                    client_uid TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    linked_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS behavior_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    local_client_id INTEGER,
                    session_hash TEXT NOT NULL,
                    event_type TEXT NOT NULL CHECK (event_type IN ('page_view', 'impression', 'click')),
                    page_key TEXT NOT NULL,
                    page_view_id TEXT NOT NULL,
                    element_key TEXT,
                    element_label TEXT,
                    target_page TEXT,
                    occurred_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ip_locations (
                    ip_address TEXT PRIMARY KEY,
                    country_code TEXT,
                    country TEXT,
                    region TEXT,
                    city TEXT,
                    network TEXT,
                    resolved_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ai_daily_usage (
                    usage_day TEXT NOT NULL,
                    subject_hash TEXT NOT NULL,
                    request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (usage_day, subject_hash)
                );

                CREATE INDEX IF NOT EXISTS idx_records_user_date
                    ON weight_records(user_id, record_date);
                CREATE INDEX IF NOT EXISTS idx_sessions_user
                    ON sessions(user_id);
                CREATE INDEX IF NOT EXISTS idx_access_events_time
                    ON access_events(occurred_at);
                CREATE INDEX IF NOT EXISTS idx_behavior_events_time
                    ON behavior_events(occurred_at);
                CREATE INDEX IF NOT EXISTS idx_behavior_events_user_time
                    ON behavior_events(user_id, occurred_at);
                CREATE INDEX IF NOT EXISTS idx_behavior_events_metric
                    ON behavior_events(page_key, event_type, element_key);
                """
            )
            user_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(users)")
            }
            if "client_uid" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN client_uid TEXT")
            if "display_name" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN display_name TEXT")
            if "passcode_ciphertext" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN passcode_ciphertext TEXT")
            if "phone_last4_salt" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN phone_last4_salt TEXT")
            if "phone_last4_hash" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN phone_last4_hash TEXT")
            if "phone_last4_ciphertext" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN phone_last4_ciphertext TEXT")
            if "font_style" not in user_columns:
                connection.execute(
                    "ALTER TABLE users ADD COLUMN font_style TEXT NOT NULL DEFAULT 'system'"
                )
            if "sound_enabled" not in user_columns:
                connection.execute(
                    "ALTER TABLE users ADD COLUMN sound_enabled INTEGER NOT NULL DEFAULT 1"
                )
            if "language" not in user_columns:
                connection.execute(
                    "ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'zh-CN'"
                )
            if "unit" not in user_columns:
                connection.execute(
                    "ALTER TABLE users ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg'"
                )
            if "height_cm" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN height_cm INTEGER")
            if "body_fat_percent" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN body_fat_percent REAL")
            if "target_weight_grams" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN target_weight_grams INTEGER")
            if "target_body_fat_percent" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN target_body_fat_percent REAL")
            if "ai_report_json" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN ai_report_json TEXT")
            if "ai_report_signature" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN ai_report_signature TEXT")
            if "ai_report_generated_at" not in user_columns:
                connection.execute("ALTER TABLE users ADD COLUMN ai_report_generated_at TEXT")
            archive_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(archived_accounts)")
            }
            if "client_uid" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN client_uid TEXT")
            if "font_style" not in archive_columns:
                connection.execute(
                    "ALTER TABLE archived_accounts ADD COLUMN font_style TEXT NOT NULL DEFAULT 'system'"
                )
            if "phone_last4_salt" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN phone_last4_salt TEXT")
            if "phone_last4_hash" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN phone_last4_hash TEXT")
            if "phone_last4_ciphertext" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN phone_last4_ciphertext TEXT")
            if "sound_enabled" not in archive_columns:
                connection.execute(
                    "ALTER TABLE archived_accounts ADD COLUMN sound_enabled INTEGER NOT NULL DEFAULT 1"
                )
            if "language" not in archive_columns:
                connection.execute(
                    "ALTER TABLE archived_accounts ADD COLUMN language TEXT NOT NULL DEFAULT 'zh-CN'"
                )
            if "unit" not in archive_columns:
                connection.execute(
                    "ALTER TABLE archived_accounts ADD COLUMN unit TEXT NOT NULL DEFAULT 'kg'"
                )
            if "height_cm" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN height_cm INTEGER")
            if "body_fat_percent" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN body_fat_percent REAL")
            if "target_weight_grams" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN target_weight_grams INTEGER")
            if "target_body_fat_percent" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN target_body_fat_percent REAL")
            if "ai_report_json" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN ai_report_json TEXT")
            if "ai_report_signature" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN ai_report_signature TEXT")
            if "ai_report_generated_at" not in archive_columns:
                connection.execute("ALTER TABLE archived_accounts ADD COLUMN ai_report_generated_at TEXT")
            connection.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_client_uid ON users(client_uid) WHERE client_uid IS NOT NULL"
            )
            access_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(access_events)")
            }
            for column, definition in {
                "ip_address": "TEXT",
                "country_code": "TEXT",
                "country": "TEXT",
                "region": "TEXT",
                "city": "TEXT",
                "network": "TEXT",
            }.items():
                if column not in access_columns:
                    connection.execute(
                        f"ALTER TABLE access_events ADD COLUMN {column} {definition}"
                    )
            location_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(ip_locations)")
            }
            if "country_code" not in location_columns:
                connection.execute("ALTER TABLE ip_locations ADD COLUMN country_code TEXT")
            behavior_columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(behavior_events)")
            }
            if "local_client_id" not in behavior_columns:
                connection.execute("ALTER TABLE behavior_events ADD COLUMN local_client_id INTEGER")
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_behavior_events_local_time ON behavior_events(local_client_id, occurred_at)"
            )
            self._expand_weight_range(connection)
            self._expand_font_styles(connection)
            self._backfill_encrypted_passcodes(connection)
        self.purge_expired_archived_accounts()

    def _expand_weight_range(self, connection: sqlite3.Connection) -> None:
        schemas = {
            row["name"]: row["sql"] or ""
            for row in connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('users', 'weight_records')"
            )
        }
        if "20000" not in schemas.get("users", "") and "20000" not in schemas.get("weight_records", ""):
            return

        connection.commit()
        connection.execute("PRAGMA foreign_keys = OFF")
        try:
            connection.executescript(
                """
                BEGIN IMMEDIATE;

                    CREATE TABLE users_weight_range_v2 (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        client_uid TEXT UNIQUE,
                        passcode_lookup TEXT NOT NULL UNIQUE,
                    passcode_salt TEXT NOT NULL,
                    passcode_hash TEXT NOT NULL,
                    passcode_ciphertext TEXT,
                    phone_last4_salt TEXT,
                    phone_last4_hash TEXT,
                    phone_last4_ciphertext TEXT,
                    display_name TEXT,
                    theme TEXT NOT NULL DEFAULT 'rose',
                    font_style TEXT NOT NULL DEFAULT 'system',
                    sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0, 1)),
                    language TEXT NOT NULL DEFAULT 'zh-CN' CHECK (language IN ('zh-CN', 'zh-HK', 'zh-TW', 'ja', 'en', 'ko')),
                        unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'jin', 'lb', 'st')),
                        height_cm INTEGER,
                        body_fat_percent REAL,
                        target_weight_grams INTEGER,
                        target_body_fat_percent REAL,
                        ai_report_json TEXT,
                        ai_report_signature TEXT,
                        ai_report_generated_at TEXT,
                        initial_weight_grams INTEGER,
                    initial_date TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK (theme IN ('rose', 'mint', 'sky', 'lilac', 'peach')),
                    CHECK (font_style IN ('system', 'serif', 'handwriting', 'humanist', 'cute', 'light')),
                    CHECK ((phone_last4_salt IS NULL AND phone_last4_hash IS NULL) OR (phone_last4_salt IS NOT NULL AND phone_last4_hash IS NOT NULL)),
                    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 10),
                        CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 230),
                        CHECK (body_fat_percent IS NULL OR body_fat_percent BETWEEN 3 AND 60),
                        CHECK (target_weight_grams IS NULL OR target_weight_grams BETWEEN 100 AND 999000),
                        CHECK (target_body_fat_percent IS NULL OR target_body_fat_percent BETWEEN 3 AND 60),
                        CHECK (initial_weight_grams IS NULL OR initial_weight_grams BETWEEN 100 AND 999000)
                    );

                    INSERT INTO users_weight_range_v2 (
                        id, client_uid, passcode_lookup, passcode_salt, passcode_hash, passcode_ciphertext,
                        phone_last4_salt, phone_last4_hash, phone_last4_ciphertext, display_name, theme, font_style, sound_enabled, language, unit, height_cm, body_fat_percent, target_weight_grams, target_body_fat_percent, ai_report_json, ai_report_signature, ai_report_generated_at,
                        initial_weight_grams, initial_date,
                        created_at, updated_at
                    )
                    SELECT
                        id, client_uid, passcode_lookup, passcode_salt, passcode_hash, passcode_ciphertext,
                        phone_last4_salt, phone_last4_hash, phone_last4_ciphertext, display_name, theme, font_style, sound_enabled, language, unit, height_cm, body_fat_percent, target_weight_grams, target_body_fat_percent, ai_report_json, ai_report_signature, ai_report_generated_at,
                        initial_weight_grams, initial_date,
                        created_at, updated_at
                    FROM users;

                DROP TABLE users;
                ALTER TABLE users_weight_range_v2 RENAME TO users;

                CREATE TABLE weight_records_weight_range_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    record_date TEXT NOT NULL,
                    weight_grams INTEGER NOT NULL CHECK (weight_grams BETWEEN 100 AND 999000),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (user_id, record_date)
                );

                INSERT INTO weight_records_weight_range_v2 (
                    id, user_id, record_date, weight_grams, created_at, updated_at
                )
                SELECT id, user_id, record_date, weight_grams, created_at, updated_at
                FROM weight_records;

                DROP TABLE weight_records;
                ALTER TABLE weight_records_weight_range_v2 RENAME TO weight_records;
                CREATE INDEX idx_records_user_date ON weight_records(user_id, record_date);

                COMMIT;
                """
            )
        finally:
            connection.execute("PRAGMA foreign_keys = ON")

        broken_references = connection.execute("PRAGMA foreign_key_check").fetchall()
        if broken_references:
            raise RuntimeError("weight range migration failed foreign key validation")

    def _expand_font_styles(self, connection: sqlite3.Connection) -> None:
        row = connection.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
        schema = (row["sql"] if row else "") or ""
        if "CHECK (font_style IN" not in schema or "'humanist'" in schema:
            return

        connection.commit()
        connection.execute("PRAGMA foreign_keys = OFF")
        try:
            connection.executescript(
                """
                BEGIN IMMEDIATE;

                    CREATE TABLE users_font_styles_v2 (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        client_uid TEXT UNIQUE,
                        passcode_lookup TEXT NOT NULL UNIQUE,
                    passcode_salt TEXT NOT NULL,
                    passcode_hash TEXT NOT NULL,
                    passcode_ciphertext TEXT,
                    phone_last4_salt TEXT,
                    phone_last4_hash TEXT,
                    phone_last4_ciphertext TEXT,
                    display_name TEXT,
                    theme TEXT NOT NULL DEFAULT 'rose',
                    font_style TEXT NOT NULL DEFAULT 'system',
                    sound_enabled INTEGER NOT NULL DEFAULT 1 CHECK (sound_enabled IN (0, 1)),
                    language TEXT NOT NULL DEFAULT 'zh-CN' CHECK (language IN ('zh-CN', 'zh-HK', 'zh-TW', 'ja', 'en', 'ko')),
                        unit TEXT NOT NULL DEFAULT 'kg' CHECK (unit IN ('kg', 'jin', 'lb', 'st')),
                        height_cm INTEGER,
                        body_fat_percent REAL,
                        target_weight_grams INTEGER,
                        target_body_fat_percent REAL,
                        ai_report_json TEXT,
                        ai_report_signature TEXT,
                        ai_report_generated_at TEXT,
                        initial_weight_grams INTEGER,
                    initial_date TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    CHECK (theme IN ('rose', 'mint', 'sky', 'lilac', 'peach')),
                    CHECK (font_style IN ('system', 'serif', 'handwriting', 'humanist', 'cute', 'light')),
                    CHECK ((phone_last4_salt IS NULL AND phone_last4_hash IS NULL) OR (phone_last4_salt IS NOT NULL AND phone_last4_hash IS NOT NULL)),
                    CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 10),
                        CHECK (height_cm IS NULL OR height_cm BETWEEN 120 AND 230),
                        CHECK (body_fat_percent IS NULL OR body_fat_percent BETWEEN 3 AND 60),
                        CHECK (target_weight_grams IS NULL OR target_weight_grams BETWEEN 100 AND 999000),
                        CHECK (target_body_fat_percent IS NULL OR target_body_fat_percent BETWEEN 3 AND 60),
                        CHECK (initial_weight_grams IS NULL OR initial_weight_grams BETWEEN 100 AND 999000)
                    );

                    INSERT INTO users_font_styles_v2 (
                        id, client_uid, passcode_lookup, passcode_salt, passcode_hash, passcode_ciphertext,
                        phone_last4_salt, phone_last4_hash, phone_last4_ciphertext, display_name, theme, font_style, sound_enabled, language, unit, height_cm, body_fat_percent, target_weight_grams, target_body_fat_percent, ai_report_json, ai_report_signature, ai_report_generated_at,
                        initial_weight_grams, initial_date, created_at, updated_at
                    )
                    SELECT
                        id, client_uid, passcode_lookup, passcode_salt, passcode_hash, passcode_ciphertext,
                        phone_last4_salt, phone_last4_hash, phone_last4_ciphertext, display_name, theme, font_style, sound_enabled, language, unit, height_cm, body_fat_percent, target_weight_grams, target_body_fat_percent, ai_report_json, ai_report_signature, ai_report_generated_at,
                        initial_weight_grams, initial_date, created_at, updated_at
                    FROM users;

                DROP TABLE users;
                ALTER TABLE users_font_styles_v2 RENAME TO users;

                COMMIT;
                """
            )
        finally:
            connection.execute("PRAGMA foreign_keys = ON")

        broken_references = connection.execute("PRAGMA foreign_key_check").fetchall()
        if broken_references:
            raise RuntimeError("font style migration failed foreign key validation")

    def _lookup(self, passcode: str) -> str:
        return hmac.new(self.secret, passcode.encode("utf-8"), hashlib.sha256).hexdigest()

    def _backfill_encrypted_passcodes(self, connection: sqlite3.Connection) -> None:
        missing = connection.execute(
            "SELECT id, passcode_lookup FROM users WHERE passcode_ciphertext IS NULL"
        ).fetchall()
        pending = {row["passcode_lookup"]: row["id"] for row in missing}
        if not pending:
            return
        for number in range(1_000_000):
            passcode = f"{number:06d}"
            user_id = pending.pop(self._lookup(passcode), None)
            if user_id is not None:
                connection.execute(
                    "UPDATE users SET passcode_ciphertext = ? WHERE id = ?",
                    (self._encrypt_passcode(passcode), user_id),
                )
            if not pending:
                break

    def _hash_passcode(self, passcode: str, salt: bytes) -> str:
        return hashlib.pbkdf2_hmac(
            "sha256",
            passcode.encode("utf-8"),
            salt + self.secret,
            PBKDF2_ITERATIONS,
        ).hex()

    def _hash_phone_last4(self, phone_last4: str, salt: bytes) -> str:
        return hashlib.pbkdf2_hmac(
            "sha256",
            phone_last4.encode("ascii"),
            b"phone-last4:v1:" + salt + self.secret,
            PBKDF2_ITERATIONS,
        ).hex()

    def _encrypt_secret(self, value: str, stream_context: bytes, auth_context: bytes) -> str:
        plaintext = value.encode("ascii")
        nonce = secrets.token_bytes(16)
        stream = hmac.new(self.secret, stream_context + nonce, hashlib.sha256).digest()
        ciphertext = bytes(value ^ stream[index] for index, value in enumerate(plaintext))
        tag = hmac.new(
            self.secret, auth_context + nonce + ciphertext, hashlib.sha256
        ).digest()
        return base64.urlsafe_b64encode(b"\x01" + nonce + ciphertext + tag).decode("ascii")

    def _decrypt_secret(
        self,
        ciphertext: str | None,
        pattern: re.Pattern[str],
        lengths: set[int],
        stream_context: bytes,
        auth_context: bytes,
    ) -> str | None:
        if not ciphertext:
            return None
        try:
            payload = base64.urlsafe_b64decode(ciphertext.encode("ascii"))
            if len(payload) not in {1 + 16 + length + 32 for length in lengths} or payload[0] != 1:
                return None
            nonce = payload[1:17]
            encrypted = payload[17:-32]
            tag = payload[-32:]
            expected = hmac.new(
                self.secret, auth_context + nonce + encrypted, hashlib.sha256
            ).digest()
            if not hmac.compare_digest(tag, expected):
                return None
            stream = hmac.new(self.secret, stream_context + nonce, hashlib.sha256).digest()
            plaintext = bytes(value ^ stream[index] for index, value in enumerate(encrypted))
            value = plaintext.decode("ascii")
            return value if pattern.fullmatch(value) else None
        except (UnicodeDecodeError, ValueError):
            return None

    def _encrypt_passcode(self, passcode: str) -> str:
        return self._encrypt_secret(
            passcode,
            b"passcode:stream:v1:",
            b"passcode:auth:v1:",
        )

    def _decrypt_passcode(self, ciphertext: str | None) -> str | None:
        return self._decrypt_secret(
            ciphertext,
            PASSCODE_PATTERN,
            {4, 6},
            b"passcode:stream:v1:",
            b"passcode:auth:v1:",
        )

    def _encrypt_phone_last4(self, phone_last4: str) -> str:
        return self._encrypt_secret(
            phone_last4,
            b"phone-last4:stream:v1:",
            b"phone-last4:auth:v1:",
        )

    def _decrypt_phone_last4(self, ciphertext: str | None) -> str | None:
        return self._decrypt_secret(
            ciphertext,
            PHONE_LAST4_PATTERN,
            {4},
            b"phone-last4:stream:v1:",
            b"phone-last4:auth:v1:",
        )

    def create_account(
        self,
        passcode: str,
        display_name: object = None,
        language: object = DEFAULT_LANGUAGE,
        phone_last4: object = None,
        client_uid: object = None,
        created_at: object = None,
    ) -> int:
        passcode = validate_passcode(passcode)
        display_name = validate_display_name(display_name)
        language = validate_language(language)
        client_uid = validate_client_uid(client_uid)
        timestamp = validate_optional_timestamp(created_at) or iso_now()
        if phone_last4 is not None:
            phone_last4 = validate_phone_last4(phone_last4)
        salt = secrets.token_bytes(16)
        phone_salt = secrets.token_bytes(16) if phone_last4 is not None else None
        phone_hash = (
            self._hash_phone_last4(phone_last4, phone_salt)
            if phone_last4 is not None and phone_salt is not None
            else None
        )
        phone_ciphertext = self._encrypt_phone_last4(phone_last4) if phone_last4 is not None else None
        try:
            with self.connect() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO users (
                        client_uid, passcode_lookup, passcode_salt, passcode_hash, passcode_ciphertext,
                        phone_last4_salt, phone_last4_hash, phone_last4_ciphertext,
                        display_name, language, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        client_uid,
                        self._lookup(passcode),
                        salt.hex(),
                        self._hash_passcode(passcode, salt),
                        self._encrypt_passcode(passcode),
                        phone_salt.hex() if phone_salt is not None else None,
                        phone_hash,
                        phone_ciphertext,
                        display_name,
                        language,
                        timestamp,
                        timestamp,
                    ),
                )
                return int(cursor.lastrowid)
        except sqlite3.IntegrityError as exc:
            raise DuplicatePasscode("这个密码已经有账户") from exc

    def passcode_available(self, passcode: object) -> bool:
        passcode = validate_passcode(passcode)
        with self.connect() as connection:
            row = connection.execute(
                "SELECT 1 FROM users WHERE passcode_lookup = ?",
                (self._lookup(passcode),),
            ).fetchone()
        return row is None

    def _authenticate_passcode_only(self, passcode: object) -> sqlite3.Row:
        passcode = validate_passcode(passcode)
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT id, passcode_salt, passcode_hash,
                       phone_last4_salt, phone_last4_hash, phone_last4_ciphertext
                FROM users WHERE passcode_lookup = ?
                """,
                (self._lookup(passcode),),
            ).fetchone()
        if row is None:
            self._hash_passcode(passcode, b"wcal-invalid-user")
            raise InvalidCredentials("密码不正确")
        candidate = self._hash_passcode(passcode, bytes.fromhex(row["passcode_salt"]))
        if not hmac.compare_digest(candidate, row["passcode_hash"]):
            raise InvalidCredentials("密码不正确")
        return row

    def authenticate(self, passcode: str, phone_last4: object = None) -> int:
        row = self._authenticate_passcode_only(passcode)
        if row["phone_last4_hash"]:
            if phone_last4 is None:
                raise PhoneLast4Required("请输入手机号后四位")
            if not isinstance(phone_last4, str) or not PHONE_LAST4_PATTERN.fullmatch(phone_last4):
                raise InvalidPhoneLast4("手机号后四位不正确")
            phone_candidate = self._hash_phone_last4(
                phone_last4,
                bytes.fromhex(row["phone_last4_salt"] or ""),
            )
            if not hmac.compare_digest(phone_candidate, row["phone_last4_hash"]):
                raise InvalidPhoneLast4("手机号后四位不正确")
            if not row["phone_last4_ciphertext"]:
                with self.connect() as connection:
                    connection.execute(
                        "UPDATE users SET phone_last4_ciphertext = ?, updated_at = ? WHERE id = ?",
                        (self._encrypt_phone_last4(phone_last4), iso_now(), int(row["id"])),
                    )
        return int(row["id"])

    def change_passcode(self, user_id: int, new_passcode: object) -> dict:
        new_passcode = validate_passcode(new_passcode)
        salt = secrets.token_bytes(16)
        try:
            with self.connect() as connection:
                cursor = connection.execute(
                    """
                    UPDATE users
                    SET passcode_lookup = ?, passcode_salt = ?, passcode_hash = ?,
                        passcode_ciphertext = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        self._lookup(new_passcode),
                        salt.hex(),
                        self._hash_passcode(new_passcode, salt),
                        self._encrypt_passcode(new_passcode),
                        iso_now(),
                        user_id,
                    ),
                )
                if cursor.rowcount == 0:
                    raise Unauthorized("账户不存在")
        except sqlite3.IntegrityError as exc:
            raise DuplicatePasscode("这个密码已经有账户") from exc
        return self.payload(user_id)

    def change_phone_last4(self, user_id: int, phone_last4: object) -> dict:
        phone_last4 = validate_phone_last4(phone_last4)
        salt = secrets.token_bytes(16)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE users
                SET phone_last4_salt = ?, phone_last4_hash = ?,
                    phone_last4_ciphertext = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    salt.hex(),
                    self._hash_phone_last4(phone_last4, salt),
                    self._encrypt_phone_last4(phone_last4),
                    iso_now(),
                    user_id,
                ),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def account_security(self, user_id: int) -> dict:
        with self.connect() as connection:
            user = connection.execute(
                """
                SELECT passcode_ciphertext, phone_last4_hash, phone_last4_ciphertext
                FROM users WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
        return {
            "ok": True,
            "passcode": self._decrypt_passcode(user["passcode_ciphertext"]),
            "phoneLast4": self._decrypt_phone_last4(user["phone_last4_ciphertext"]),
            "phoneLast4Required": bool(user["phone_last4_hash"]),
        }

    def create_session(self, user_id: int) -> str:
        token = secrets.token_urlsafe(36)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        created = utc_now()
        expires = created + timedelta(days=SESSION_DAYS)
        with self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (created.isoformat(),))
            connection.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash, user_id, created.isoformat(), expires.isoformat()),
            )
        return token

    def user_id_for_session(self, token: str | None, *, renew: bool = False) -> int:
        if not token:
            raise Unauthorized("请先登录")
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = utc_now()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
                (token_hash,),
            ).fetchone()
            if row is None or row["expires_at"] <= now.isoformat():
                connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
                raise Unauthorized("登录已过期")
            if renew:
                connection.execute(
                    "UPDATE sessions SET expires_at = ? WHERE token_hash = ?",
                    ((now + timedelta(days=SESSION_DAYS)).isoformat(), token_hash),
                )
        return int(row["user_id"])

    def delete_session(self, token: str | None) -> None:
        if not token:
            return
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self.connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def create_admin_session(self) -> str:
        token = secrets.token_urlsafe(36)
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        created = utc_now()
        expires = created + timedelta(hours=ADMIN_SESSION_HOURS)
        with self.connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE expires_at <= ?", (created.isoformat(),))
            connection.execute(
                "INSERT INTO admin_sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)",
                (token_hash, created.isoformat(), expires.isoformat()),
            )
        return token

    def require_admin_session(self, token: str | None) -> None:
        if not token:
            raise Unauthorized("请输入管理密码")
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now = utc_now().isoformat()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT expires_at FROM admin_sessions WHERE token_hash = ?", (token_hash,)
            ).fetchone()
            if row is None or row["expires_at"] <= now:
                connection.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))
                raise Unauthorized("管理登录已过期")

    def delete_admin_session(self, token: str | None) -> None:
        if not token:
            return
        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        with self.connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE token_hash = ?", (token_hash,))

    @staticmethod
    def _ai_report_from_row(row: sqlite3.Row) -> dict | None:
        raw = row["ai_report_json"]
        if not raw:
            return None
        try:
            report = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None
        if not isinstance(report, dict) or not isinstance(report.get("analysis"), dict):
            return None
        if row["ai_report_signature"] and not report.get("inputSignature"):
            report["inputSignature"] = row["ai_report_signature"]
        if row["ai_report_generated_at"] and not report.get("generatedAt"):
            report["generatedAt"] = row["ai_report_generated_at"]
        return report

    def payload(self, user_id: int) -> dict:
        with self.connect() as connection:
            user = connection.execute(
                """
                SELECT id, client_uid, display_name, theme, font_style, sound_enabled, language, unit,
                       height_cm, body_fat_percent, target_weight_grams, target_body_fat_percent,
                       ai_report_json, ai_report_signature, ai_report_generated_at,
                       phone_last4_hash,
                       initial_weight_grams, initial_date, created_at
                FROM users WHERE id = ?
                """,
                (user_id,),
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            records = connection.execute(
                """
                SELECT record_date, weight_grams, updated_at
                FROM weight_records WHERE user_id = ? ORDER BY record_date
                """,
                (user_id,),
            ).fetchall()
        return {
            "account": {
                "userId": user["client_uid"] or f"cloud-{user['id']}",
                "syncEnabled": True,
                "displayName": user["display_name"],
                "theme": user["theme"],
                "fontStyle": user["font_style"],
                "soundEnabled": bool(user["sound_enabled"]),
                "language": user["language"],
                "unit": user["unit"],
                "heightCm": user["height_cm"],
                "bodyFatPercent": user["body_fat_percent"],
                "targetWeightGrams": user["target_weight_grams"],
                "targetBodyFatPercent": user["target_body_fat_percent"],
                "aiReport": self._ai_report_from_row(user),
                "phoneLast4Required": bool(user["phone_last4_hash"]),
                "initialWeightGrams": user["initial_weight_grams"],
                "initialDate": user["initial_date"],
                "createdAt": user["created_at"],
            },
            "records": [
                {
                    "date": row["record_date"],
                    "weightGrams": row["weight_grams"],
                    "updatedAt": row["updated_at"],
                }
                for row in records
            ],
        }

    def set_initial(self, user_id: int, record_date: object, weight_grams: object) -> dict:
        record_date = validate_date(record_date)
        weight_grams = validate_weight(weight_grams)
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute(
                "SELECT initial_date FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            if user["initial_date"] is not None:
                raise Conflict("初始体重已经设置")
            connection.execute(
                """
                UPDATE users
                SET initial_weight_grams = ?, initial_date = ?, updated_at = ?
                WHERE id = ?
                """,
                (weight_grams, record_date, timestamp, user_id),
            )
            connection.execute(
                """
                INSERT INTO weight_records (
                    user_id, record_date, weight_grams, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, record_date, weight_grams, timestamp, timestamp),
            )
        return self.payload(user_id)

    def upsert_record(self, user_id: int, record_date: object, weight_grams: object) -> dict:
        record_date = validate_date(record_date)
        weight_grams = validate_weight(weight_grams)
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute(
                "SELECT initial_date FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            if user["initial_date"] is None:
                raise Conflict("请先设置初始体重")
            connection.execute(
                """
                INSERT INTO weight_records (
                    user_id, record_date, weight_grams, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id, record_date) DO UPDATE SET
                    weight_grams = excluded.weight_grams,
                    updated_at = excluded.updated_at
                """,
                (user_id, record_date, weight_grams, timestamp, timestamp),
            )
            if record_date <= user["initial_date"]:
                connection.execute(
                    """
                    UPDATE users
                    SET initial_weight_grams = ?, initial_date = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (weight_grams, record_date, timestamp, user_id),
                )
        return self.payload(user_id)

    def delete_record(self, user_id: int, record_date: object) -> dict:
        record_date = validate_date(record_date)
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute(
                "SELECT id FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            connection.execute(
                "DELETE FROM weight_records WHERE user_id = ? AND record_date = ?",
                (user_id, record_date),
            )
            first_record = connection.execute(
                """
                SELECT record_date, weight_grams
                FROM weight_records
                WHERE user_id = ?
                ORDER BY record_date
                LIMIT 1
                """,
                (user_id,),
            ).fetchone()
            connection.execute(
                """
                UPDATE users
                SET initial_weight_grams = ?, initial_date = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    first_record["weight_grams"] if first_record else None,
                    first_record["record_date"] if first_record else None,
                    timestamp,
                    user_id,
                ),
            )
        return self.payload(user_id)

    def set_theme(self, user_id: int, theme: object) -> dict:
        if not isinstance(theme, str) or theme not in THEMES:
            raise AppError("背景颜色不存在")
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET theme = ?, updated_at = ? WHERE id = ?",
                (theme, iso_now(), user_id),
            )
        return self.payload(user_id)

    def set_font_style(self, user_id: int, font_style: object) -> dict:
        font_style = validate_font_style(font_style)
        with self.connect() as connection:
            connection.execute(
                "UPDATE users SET font_style = ?, updated_at = ? WHERE id = ?",
                (font_style, iso_now(), user_id),
            )
        return self.payload(user_id)

    def set_sound_enabled(self, user_id: int, sound_enabled: object) -> dict:
        sound_enabled = validate_sound_enabled(sound_enabled)
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET sound_enabled = ?, updated_at = ? WHERE id = ?",
                (int(sound_enabled), iso_now(), user_id),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def set_language(self, user_id: int, language: object) -> dict:
        language = validate_language(language)
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET language = ?, updated_at = ? WHERE id = ?",
                (language, iso_now(), user_id),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def set_weight_unit(self, user_id: int, unit: object) -> dict:
        unit = validate_weight_unit(unit)
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET unit = ?, updated_at = ? WHERE id = ?",
                (unit, iso_now(), user_id),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def set_display_name(self, user_id: int, display_name: object) -> dict:
        display_name = validate_display_name(display_name)
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?",
                (display_name, iso_now(), user_id),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def set_health_profile(
        self,
        user_id: int,
        height_cm: object,
        body_fat_percent: object,
        target_weight_grams: object = None,
        target_body_fat_percent: object = None,
    ) -> dict:
        height_cm, body_fat_percent = validate_health_profile(height_cm, body_fat_percent)
        target_weight_grams = validate_optional_weight(target_weight_grams)
        target_body_fat_percent = validate_optional_body_fat_percent(target_body_fat_percent)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE users
                SET height_cm = ?, body_fat_percent = ?, target_weight_grams = ?,
                    target_body_fat_percent = ?, updated_at = ?
                WHERE id = ?
                """,
                (height_cm, body_fat_percent, target_weight_grams, target_body_fat_percent, iso_now(), user_id),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def health_context(self, user_id: int) -> dict:
        payload = self.payload(user_id)
        account = payload["account"]
        return build_health_context(
            payload["records"],
            total_record_count=len(payload["records"]),
            current_body_fat_percent=account["bodyFatPercent"],
            target_weight_grams=account["targetWeightGrams"],
            target_body_fat_percent=account["targetBodyFatPercent"],
        )

    def merge_client_data(self, user_id: int, client_data: object, precedence: object = "local") -> dict:
        if precedence not in {"local", "cloud"}:
            raise AppError("请选择合并方式")
        if not isinstance(client_data, dict):
            raise AppError("本地数据格式不正确")
        account = client_data.get("account")
        if not isinstance(account, dict):
            account = {}
        records = sanitize_client_records(client_data.get("records"))

        candidate_updates: dict[str, object] = {}
        if "displayName" in account:
            candidate_updates["display_name"] = validate_display_name(account.get("displayName"))
        if "theme" in account and account.get("theme") is not None:
            theme = account.get("theme")
            if not isinstance(theme, str) or theme not in THEMES:
                raise AppError("背景颜色不存在")
            candidate_updates["theme"] = theme
        if "fontStyle" in account and account.get("fontStyle") is not None:
            candidate_updates["font_style"] = validate_font_style(account.get("fontStyle"))
        if "soundEnabled" in account and account.get("soundEnabled") is not None:
            candidate_updates["sound_enabled"] = int(validate_sound_enabled(account.get("soundEnabled")))
        if "language" in account and account.get("language") is not None:
            candidate_updates["language"] = validate_language(account.get("language"))
        if "unit" in account and account.get("unit") is not None:
            candidate_updates["unit"] = validate_weight_unit(account.get("unit"))
        if "heightCm" in account:
            candidate_updates["height_cm"] = validate_optional_height_cm(account.get("heightCm"))
        if "bodyFatPercent" in account:
            candidate_updates["body_fat_percent"] = validate_optional_body_fat_percent(account.get("bodyFatPercent"))
        if "targetWeightGrams" in account:
            candidate_updates["target_weight_grams"] = validate_optional_weight(account.get("targetWeightGrams"))
        if "targetBodyFatPercent" in account:
            candidate_updates["target_body_fat_percent"] = validate_optional_body_fat_percent(account.get("targetBodyFatPercent"))

        client_uid = validate_client_uid(account.get("userId") or account.get("localUserId"))
        client_created_at = validate_optional_timestamp(account.get("createdAt"))
        cached_report = sanitize_cached_ai_report(account.get("aiReport"))
        timestamp = iso_now()

        try:
            with self.connect() as connection:
                user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if user is None:
                    raise Unauthorized("账户不存在")

                if client_uid and client_created_at:
                    existing_identity = user["client_uid"] or f"cloud-{user['id']}"
                    keep_client_identity = timestamp_sort_value(client_created_at) < timestamp_sort_value(user["created_at"])
                    if keep_client_identity and client_uid != existing_identity:
                        connection.execute(
                            "UPDATE users SET client_uid = ?, created_at = ? WHERE id = ?",
                            (client_uid, client_created_at, user_id),
                        )

                applied_updates: dict[str, object] = {}
                if precedence == "local":
                    applied_updates.update(candidate_updates)
                else:
                    for column, value in candidate_updates.items():
                        current_value = user[column]
                        if current_value in (None, "") and value not in (None, ""):
                            applied_updates[column] = value
                if applied_updates:
                    connection.execute(
                        f"""
                        UPDATE users
                        SET {", ".join(f"{column} = ?" for column in applied_updates)}, updated_at = ?
                        WHERE id = ?
                        """,
                        tuple(applied_updates.values()) + (timestamp, user_id),
                    )

                if cached_report is not None and (precedence == "local" or not user["ai_report_json"]):
                    report_signature = validate_optional_signature(cached_report.get("inputSignature"))
                    report_generated_at = validate_optional_timestamp(cached_report.get("generatedAt")) or timestamp
                    raw_report = json.dumps(
                        {
                            **cached_report,
                            "inputSignature": report_signature,
                            "generatedAt": report_generated_at,
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                    connection.execute(
                        """
                        UPDATE users
                        SET ai_report_json = ?, ai_report_signature = ?,
                            ai_report_generated_at = ?, updated_at = ?
                        WHERE id = ?
                        """,
                        (raw_report, report_signature, report_generated_at, timestamp, user_id),
                    )

                for record in records:
                    if precedence == "local":
                        connection.execute(
                            """
                            INSERT INTO weight_records (
                                user_id, record_date, weight_grams, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(user_id, record_date) DO UPDATE SET
                                weight_grams = excluded.weight_grams,
                                updated_at = excluded.updated_at
                            """,
                            (user_id, record["date"], record["weightGrams"], record["updatedAt"], record["updatedAt"]),
                        )
                    else:
                        connection.execute(
                            """
                            INSERT OR IGNORE INTO weight_records (
                                user_id, record_date, weight_grams, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?)
                            """,
                            (user_id, record["date"], record["weightGrams"], record["updatedAt"], record["updatedAt"]),
                        )

                first_record = connection.execute(
                    """
                    SELECT record_date, weight_grams
                    FROM weight_records
                    WHERE user_id = ?
                    ORDER BY record_date
                    LIMIT 1
                    """,
                    (user_id,),
                ).fetchone()
                connection.execute(
                    """
                    UPDATE users
                    SET initial_weight_grams = ?, initial_date = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        first_record["weight_grams"] if first_record else None,
                        first_record["record_date"] if first_record else None,
                        timestamp,
                        user_id,
                    ),
                )
                self._promote_local_client(connection, client_uid, user_id)
        except sqlite3.IntegrityError as exc:
            raise Conflict("这个本地用户编号已经绑定到其他云端账户") from exc

        return self.payload(user_id)

    def consume_ai_daily_quota(self, subject: str, limit: int = AI_DAILY_LIMIT) -> int:
        if not isinstance(subject, str) or not subject.strip():
            raise AppError("AI 分析用户标识不正确")
        usage_day = local_today().isoformat()
        subject_hash = hmac.new(self.secret, subject.strip().encode("utf-8"), hashlib.sha256).hexdigest()
        timestamp = iso_now()
        cleanup_before = (local_today() - timedelta(days=40)).isoformat()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT request_count FROM ai_daily_usage WHERE usage_day = ? AND subject_hash = ?",
                (usage_day, subject_hash),
            ).fetchone()
            count = int(row["request_count"]) if row else 0
            if count >= limit:
                raise AiDailyLimit(f"今天已经完成 {limit} 次 AI 分析，明天再来看看")
            next_count = count + 1
            connection.execute(
                """
                INSERT INTO ai_daily_usage (usage_day, subject_hash, request_count, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(usage_day, subject_hash) DO UPDATE SET
                    request_count = excluded.request_count,
                    updated_at = excluded.updated_at
                """,
                (usage_day, subject_hash, next_count, timestamp),
            )
            connection.execute("DELETE FROM ai_daily_usage WHERE usage_day < ?", (cleanup_before,))
        return max(0, limit - next_count)

    def set_ai_report(self, user_id: int, report: object, input_signature: object = None) -> dict:
        if not isinstance(report, dict):
            raise AppError("AI 报告格式不正确")
        signature = validate_optional_signature(input_signature)
        generated_at = iso_now()
        report_payload = {
            **report,
            "inputSignature": signature,
            "generatedAt": generated_at,
        }
        sanitized = sanitize_cached_ai_report(report_payload)
        raw = json.dumps(sanitized, ensure_ascii=False, separators=(",", ":"))
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE users
                SET ai_report_json = ?, ai_report_signature = ?,
                    ai_report_generated_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (raw, signature, generated_at, generated_at, user_id),
            )
            if cursor.rowcount == 0:
                raise Unauthorized("账户不存在")
        return self.payload(user_id)

    def verify_passcode(self, user_id: int, passcode: object) -> None:
        authenticated_user_id = int(self._authenticate_passcode_only(passcode)["id"])
        if authenticated_user_id != user_id:
            raise InvalidCredentials("当前账户密码不正确")

    def export_payload(self, user_id: int) -> dict:
        payload = self.payload(user_id)
        return {
            "schemaVersion": 1,
            "exportedAt": iso_now(),
            "account": payload["account"],
            "records": [
                {
                    **record,
                    "weightKg": round(record["weightGrams"] / 1000, 1),
                }
                for record in payload["records"]
            ],
        }

    def archive_account(self, user_id: int) -> dict:
        timestamp = iso_now()
        with self.connect() as connection:
            user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if user is None:
                raise Unauthorized("账户不存在")
            records = connection.execute(
                """
                SELECT record_date, weight_grams, created_at, updated_at
                FROM weight_records WHERE user_id = ? ORDER BY record_date
                """,
                (user_id,),
            ).fetchall()
            archived_records = [
                {
                    "date": row["record_date"],
                    "weightGrams": row["weight_grams"],
                    "createdAt": row["created_at"],
                    "updatedAt": row["updated_at"],
                }
                for row in records
            ]
            connection.execute(
                """
                    INSERT INTO archived_accounts (
                        original_user_id, client_uid, display_name, passcode_ciphertext,
                        phone_last4_salt, phone_last4_hash, phone_last4_ciphertext,
                        theme, font_style, sound_enabled, language, unit, height_cm, body_fat_percent,
                        target_weight_grams, target_body_fat_percent,
                        ai_report_json, ai_report_signature, ai_report_generated_at,
                        initial_weight_grams, initial_date, account_created_at,
                        account_updated_at, archived_at, records_json, record_count
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user["id"],
                        user["client_uid"],
                        user["display_name"],
                        user["passcode_ciphertext"],
                    user["phone_last4_salt"],
                    user["phone_last4_hash"],
                    user["phone_last4_ciphertext"],
                    user["theme"],
                    user["font_style"],
                    user["sound_enabled"],
                    user["language"],
                        user["unit"],
                        user["height_cm"],
                        user["body_fat_percent"],
                        user["target_weight_grams"],
                        user["target_body_fat_percent"],
                        user["ai_report_json"],
                        user["ai_report_signature"],
                        user["ai_report_generated_at"],
                        user["initial_weight_grams"],
                    user["initial_date"],
                    user["created_at"],
                    user["updated_at"],
                    timestamp,
                    json.dumps(archived_records, ensure_ascii=False, separators=(",", ":")),
                    len(archived_records),
                ),
            )
            connection.execute("DELETE FROM users WHERE id = ?", (user_id,))
        return {"ok": True, "archivedAt": timestamp}

    def purge_expired_archived_accounts(self, now: datetime | None = None) -> int:
        cutoff = (now or utc_now()) - timedelta(days=ARCHIVED_ACCOUNT_RETENTION_DAYS)
        with self.connect() as connection:
            expired = connection.execute(
                "SELECT id, original_user_id FROM archived_accounts WHERE archived_at <= ?",
                (cutoff.isoformat(),),
            ).fetchall()
            for archive in expired:
                archive_id = int(archive["id"])
                original_user_id = int(archive["original_user_id"])
                anonymous_user_id = -archive_id
                anonymous_session_hash = hmac.new(
                    self.secret,
                    f"purged-session:{archive_id}".encode("utf-8"),
                    hashlib.sha256,
                ).hexdigest()
                anonymous_visitor_hash = hmac.new(
                    self.secret,
                    f"purged-visitor:{archive_id}".encode("utf-8"),
                    hashlib.sha256,
                ).hexdigest()
                connection.execute(
                    """
                    UPDATE behavior_events
                    SET user_id = ?, session_hash = ?
                    WHERE user_id = ?
                    """,
                    (anonymous_user_id, anonymous_session_hash, original_user_id),
                )
                connection.execute(
                    """
                    UPDATE access_events
                    SET visitor_hash = ?, ip_address = NULL, user_id = NULL,
                        user_agent = NULL, country_code = NULL, country = NULL,
                        region = NULL, city = NULL, network = NULL
                    WHERE user_id = ?
                    """,
                    (anonymous_visitor_hash, original_user_id),
                )
            if expired:
                connection.executemany(
                    "DELETE FROM archived_accounts WHERE id = ?",
                    [(int(archive["id"]),) for archive in expired],
                )
            return len(expired)

    def cached_ip_location(self, client_ip: str) -> dict[str, str | None] | None:
        normalized = normalize_ip(client_ip)
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM ip_locations WHERE ip_address = ?", (normalized,)
            ).fetchone()
        if row is None:
            return None
        try:
            resolved_at = datetime.fromisoformat(row["resolved_at"])
        except (TypeError, ValueError):
            return None
        has_location = any(
            row[field] for field in ("country_code", "country", "region", "city", "network")
        )
        ttl = GEOLOCATION_SUCCESS_TTL if has_location else GEOLOCATION_FAILURE_TTL
        if resolved_at <= utc_now() - ttl:
            return None
        return {
            "country_code": row["country_code"],
            "country": row["country"],
            "region": row["region"],
            "city": row["city"],
            "network": row["network"],
        }

    def cache_ip_location(self, client_ip: str, location: dict[str, str | None]) -> None:
        normalized = normalize_ip(client_ip)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO ip_locations (
                    ip_address, country_code, country, region, city, network, resolved_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(ip_address) DO UPDATE SET
                    country_code = excluded.country_code,
                    country = excluded.country,
                    region = excluded.region,
                    city = excluded.city,
                    network = excluded.network,
                    resolved_at = excluded.resolved_at
                """,
                (
                    normalized,
                    location.get("country_code"),
                    location.get("country"),
                    location.get("region"),
                    location.get("city"),
                    location.get("network"),
                    iso_now(),
                ),
            )

    def record_visit(
        self,
        client_ip: str,
        path: object,
        user_agent: str | None,
        user_id: int | None,
        location: dict[str, str | None] | None = None,
    ) -> None:
        normalized_ip = normalize_ip(client_ip)
        safe_path = path if isinstance(path, str) and path in {"/", "/data"} else "/"
        visitor_hash = hmac.new(
            self.secret, f"visitor:{normalized_ip}".encode("utf-8"), hashlib.sha256
        ).hexdigest()
        safe_agent = (user_agent or "")[:180]
        location = location or {}
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO access_events (
                    visitor_hash, ip_address, path, user_id, user_agent,
                    country_code, country, region, city, network, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    visitor_hash,
                    normalized_ip,
                    safe_path,
                    user_id,
                    safe_agent,
                    location.get("country_code"),
                    location.get("country"),
                    location.get("region"),
                    location.get("city"),
                    location.get("network"),
                    iso_now(),
                ),
            )

    def _local_client_values(self, client_uid: str, client_data: object) -> dict:
        if not isinstance(client_data, dict):
            raise AppError("本地数据格式不正确")
        account = client_data.get("account")
        if not isinstance(account, dict):
            account = {}
        payload_uid = validate_client_uid(account.get("userId") or account.get("localUserId"))
        if payload_uid and payload_uid != client_uid:
            raise Conflict("本地用户编号不一致")
        records = sanitize_client_records(client_data.get("records"))
        theme = account.get("theme") or "rose"
        if not isinstance(theme, str) or theme not in THEMES:
            raise AppError("背景颜色不存在")
        report = sanitize_cached_ai_report(account.get("aiReport"))
        first_record = records[0] if records else None
        created_at = validate_optional_timestamp(account.get("createdAt")) or iso_now()
        return {
            "client_uid": client_uid,
            "display_name": validate_display_name(account.get("displayName")),
            "theme": theme,
            "font_style": validate_font_style(account.get("fontStyle") or "system"),
            "sound_enabled": int(validate_sound_enabled(account.get("soundEnabled", True))),
            "language": validate_language(account.get("language") or DEFAULT_LANGUAGE),
            "unit": validate_weight_unit(account.get("unit") or DEFAULT_WEIGHT_UNIT),
            "height_cm": validate_optional_height_cm(account.get("heightCm")),
            "body_fat_percent": validate_optional_body_fat_percent(account.get("bodyFatPercent")),
            "target_weight_grams": validate_optional_weight(account.get("targetWeightGrams")),
            "target_body_fat_percent": validate_optional_body_fat_percent(account.get("targetBodyFatPercent")),
            "ai_report_json": json.dumps(report, ensure_ascii=False, separators=(",", ":")) if report else None,
            "initial_weight_grams": first_record["weightGrams"] if first_record else None,
            "initial_date": first_record["date"] if first_record else None,
            "records_json": json.dumps(records, ensure_ascii=False, separators=(",", ":")),
            "record_count": len(records),
            "created_at": created_at,
            "updated_at": iso_now(),
        }

    def ensure_local_client(self, client_uid: object) -> int:
        client_uid = validate_client_uid(client_uid)
        if client_uid is None:
            raise AppError("本地用户编号不正确")
        timestamp = iso_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO local_clients (client_uid, created_at, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(client_uid) DO UPDATE SET updated_at = excluded.updated_at
                """,
                (client_uid, timestamp, timestamp),
            )
            row = connection.execute(
                "SELECT id FROM local_clients WHERE client_uid = ?", (client_uid,)
            ).fetchone()
        return int(row["id"])

    def upsert_local_client(self, client_uid: object, client_data: object) -> dict:
        client_uid = validate_client_uid(client_uid)
        if client_uid is None:
            raise AppError("本地用户编号不正确")
        values = self._local_client_values(client_uid, client_data)
        columns = list(values)
        update_columns = [column for column in columns if column not in {"client_uid", "created_at"}]
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            linked = connection.execute(
                "SELECT user_id FROM local_client_links WHERE client_uid = ?", (client_uid,)
            ).fetchone()
            if linked is not None:
                return {
                    "ok": True,
                    "promoted": True,
                    "userId": int(linked["user_id"]),
                    "recordCount": len(json.loads(values["records_json"])),
                    "updatedAt": values["updated_at"],
                }
            connection.execute(
                f"""
                INSERT INTO local_clients ({", ".join(columns)})
                VALUES ({", ".join("?" for _ in columns)})
                ON CONFLICT(client_uid) DO UPDATE SET
                    {", ".join(f"{column} = excluded.{column}" for column in update_columns)}
                """,
                tuple(values[column] for column in columns),
            )
            row = connection.execute(
                "SELECT id, record_count, updated_at FROM local_clients WHERE client_uid = ?",
                (client_uid,),
            ).fetchone()
        return {
            "ok": True,
            "localClientId": int(row["id"]),
            "recordCount": int(row["record_count"]),
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _promote_local_client(
        connection: sqlite3.Connection, client_uid: str | None, user_id: int
    ) -> None:
        if client_uid is None:
            return
        connection.execute(
            """
            INSERT INTO local_client_links (client_uid, user_id, linked_at)
            VALUES (?, ?, ?)
            ON CONFLICT(client_uid) DO UPDATE SET
                user_id = excluded.user_id,
                linked_at = excluded.linked_at
            """,
            (client_uid, user_id, iso_now()),
        )
        local_client = connection.execute(
            "SELECT id FROM local_clients WHERE client_uid = ?", (client_uid,)
        ).fetchone()
        if local_client is None:
            return
        connection.execute(
            """
            UPDATE behavior_events
            SET user_id = ?, local_client_id = NULL
            WHERE local_client_id = ?
            """,
            (user_id, local_client["id"]),
        )
        connection.execute("DELETE FROM local_clients WHERE id = ?", (local_client["id"],))

    def record_behavior_events(
        self,
        user_id: int,
        session_token: str,
        events: object,
    ) -> int:
        validated = validate_analytics_events(events)
        session_hash = hashlib.sha256(session_token.encode("utf-8")).hexdigest()
        received_at = utc_now()
        with self.connect() as connection:
            connection.executemany(
                """
                INSERT INTO behavior_events (
                    user_id, local_client_id, session_hash, event_type, page_key, page_view_id,
                    element_key, element_label, target_page, occurred_at
                ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        user_id,
                        session_hash,
                        event["eventType"],
                        event["pageKey"],
                        event["pageViewId"],
                        event["elementKey"],
                        event["elementLabel"],
                        event["targetPage"],
                        (received_at + timedelta(microseconds=index)).isoformat(timespec="microseconds"),
                    )
                    for index, event in enumerate(validated)
                ],
            )
        return len(validated)

    def record_local_behavior_events(self, client_uid: object, events: object) -> int:
        client_uid = validate_client_uid(client_uid)
        if client_uid is None:
            raise AppError("本地用户编号不正确")
        validated = validate_analytics_events(events)
        session_hash = hmac.new(
            self.secret, f"local:{client_uid}".encode("utf-8"), hashlib.sha256
        ).hexdigest()
        received_at = utc_now()
        with self.connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            linked = connection.execute(
                "SELECT user_id FROM local_client_links WHERE client_uid = ?", (client_uid,)
            ).fetchone()
            if linked is not None:
                user_id = int(linked["user_id"])
                local_client_id = None
            else:
                timestamp = iso_now()
                connection.execute(
                    """
                    INSERT INTO local_clients (client_uid, created_at, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(client_uid) DO UPDATE SET updated_at = excluded.updated_at
                    """,
                    (client_uid, timestamp, timestamp),
                )
                local_client = connection.execute(
                    "SELECT id FROM local_clients WHERE client_uid = ?", (client_uid,)
                ).fetchone()
                user_id = 0
                local_client_id = int(local_client["id"])
            connection.executemany(
                """
                INSERT INTO behavior_events (
                    user_id, local_client_id, session_hash, event_type, page_key, page_view_id,
                    element_key, element_label, target_page, occurred_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        user_id,
                        local_client_id,
                        session_hash,
                        event["eventType"],
                        event["pageKey"],
                        event["pageViewId"],
                        event["elementKey"],
                        event["elementLabel"],
                        event["targetPage"],
                        (received_at + timedelta(microseconds=index)).isoformat(timespec="microseconds"),
                    )
                    for index, event in enumerate(validated)
                ],
            )
        return len(validated)

    @staticmethod
    def _analytics_ctr(numerator: int, denominator: int) -> float:
        if denominator <= 0:
            return 0.0
        return round(numerator / denominator * 100, 1)

    def admin_behavior_analytics(self, window_days: int = 7) -> dict:
        if window_days < 1 or window_days > 365:
            raise AppError("统计时间范围不正确")
        since = utc_now() - timedelta(days=window_days)
        with self.connect() as connection:
            page_rows = connection.execute(
                """
                SELECT
                    page_key,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN page_view_id END) AS page_views,
                    COUNT(DISTINCT CASE WHEN event_type = 'click' THEN page_view_id END) AS interactive_views,
                    SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN
                        CASE WHEN local_client_id IS NOT NULL
                            THEN 'local:' || local_client_id
                            ELSE 'account:' || user_id
                        END
                    END) AS users
                FROM behavior_events
                WHERE occurred_at >= ?
                GROUP BY page_key
                ORDER BY page_views DESC, clicks DESC, page_key
                """,
                (since.isoformat(),),
            ).fetchall()
            feature_rows = connection.execute(
                """
                SELECT
                    page_key,
                    element_key,
                    MAX(CASE WHEN element_label IS NOT NULL THEN element_label END) AS element_label,
                    COUNT(DISTINCT CASE WHEN event_type = 'impression' THEN page_view_id END) AS impression_views,
                    COUNT(DISTINCT CASE WHEN event_type = 'click' THEN page_view_id END) AS click_views,
                    SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks
                FROM behavior_events
                WHERE occurred_at >= ? AND element_key IS NOT NULL
                GROUP BY page_key, element_key
                HAVING impression_views > 0 OR click_views > 0
                ORDER BY clicks DESC, impression_views DESC, page_key, element_key
                """,
                (since.isoformat(),),
            ).fetchall()
            totals = connection.execute(
                """
                SELECT
                    COUNT(DISTINCT CASE WHEN local_client_id IS NOT NULL
                        THEN 'local:' || local_client_id
                        ELSE 'account:' || user_id
                    END) AS users,
                    COUNT(DISTINCT CASE WHEN event_type = 'page_view' THEN page_view_id END) AS page_views,
                    SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks
                FROM behavior_events
                WHERE occurred_at >= ?
                """,
                (since.isoformat(),),
            ).fetchone()
            summary_rows = connection.execute(
                """
                SELECT
                    user_id,
                    local_client_id,
                    COUNT(*) AS event_count,
                    SUM(CASE WHEN event_type = 'page_view' THEN 1 ELSE 0 END) AS page_views,
                    SUM(CASE WHEN event_type = 'click' THEN 1 ELSE 0 END) AS clicks,
                    MAX(occurred_at) AS last_event_at
                FROM behavior_events
                GROUP BY user_id, local_client_id
                """
            ).fetchall()
            users = connection.execute("SELECT id, display_name FROM users").fetchall()
            archives = connection.execute(
                """
                SELECT original_user_id, display_name, archived_at
                FROM archived_accounts ORDER BY archived_at DESC
                """
            ).fetchall()
            local_clients = connection.execute(
                "SELECT id, display_name FROM local_clients"
            ).fetchall()

        identities: dict[str, dict] = {
            f"account:{int(row['id'])}": {
                "displayName": row["display_name"],
                "state": "active",
                "subjectType": "account",
                "subjectId": int(row["id"]),
            }
            for row in users
        }
        for row in archives:
            identities.setdefault(
                f"account:{int(row['original_user_id'])}",
                {
                    "displayName": row["display_name"],
                    "state": "archived",
                    "subjectType": "account",
                    "subjectId": int(row["original_user_id"]),
                },
            )
        for row in local_clients:
            identities[f"local:{int(row['id'])}"] = {
                "displayName": row["display_name"],
                "state": "local",
                "subjectType": "local",
                "subjectId": int(row["id"]),
            }
        summaries = {
            (
                f"local:{int(row['local_client_id'])}"
                if row["local_client_id"] is not None
                else f"account:{int(row['user_id'])}"
            ): {
                "eventCount": int(row["event_count"] or 0),
                "pageViews": int(row["page_views"] or 0),
                "clicks": int(row["clicks"] or 0),
                "lastEventAt": row["last_event_at"],
            }
            for row in summary_rows
        }
        user_ids = set(identities) | set(summaries)
        user_summaries = []
        for subject_key in user_ids:
            subject_type, raw_subject_id = subject_key.split(":", 1)
            subject_id = int(raw_subject_id)
            identity = identities.get(
                subject_key,
                {
                    "displayName": None,
                    "state": "anonymized",
                    "subjectType": subject_type,
                    "subjectId": subject_id,
                },
            )
            metrics = summaries.get(
                subject_key,
                {"eventCount": 0, "pageViews": 0, "clicks": 0, "lastEventAt": None},
            )
            user_summaries.append(
                {
                    "subjectKey": subject_key,
                    "subjectType": identity["subjectType"],
                    "subjectId": identity["subjectId"],
                    "userId": identity["subjectId"],
                    "displayName": identity["displayName"],
                    "state": identity["state"],
                    **metrics,
                }
            )
        user_summaries.sort(
            key=lambda item: (item["lastEventAt"] or "", item["subjectKey"]), reverse=True
        )
        return {
            "windowDays": window_days,
            "since": since.isoformat(timespec="seconds"),
            "totals": {
                "users": int(totals["users"] or 0),
                "pageViews": int(totals["page_views"] or 0),
                "clicks": int(totals["clicks"] or 0),
            },
            "pages": [
                {
                    "pageKey": row["page_key"],
                    "pageViews": int(row["page_views"] or 0),
                    "interactiveViews": int(row["interactive_views"] or 0),
                    "clicks": int(row["clicks"] or 0),
                    "users": int(row["users"] or 0),
                    "ctr": self._analytics_ctr(
                        int(row["interactive_views"] or 0), int(row["page_views"] or 0)
                    ),
                }
                for row in page_rows
            ],
            "features": [
                {
                    "pageKey": row["page_key"],
                    "elementKey": row["element_key"],
                    "elementLabel": row["element_label"],
                    "impressionViews": int(row["impression_views"] or 0),
                    "clickViews": int(row["click_views"] or 0),
                    "clicks": int(row["clicks"] or 0),
                    "ctr": self._analytics_ctr(
                        int(row["click_views"] or 0), int(row["impression_views"] or 0)
                    ),
                }
                for row in feature_rows
            ],
            "users": user_summaries,
        }

    def admin_user_journey(self, subject: object, limit: int = 300) -> dict:
        if isinstance(subject, bool):
            raise AppError("用户编号不正确")
        if isinstance(subject, int):
            subject_type = "account"
            subject_id = subject
        elif isinstance(subject, str):
            if re.fullmatch(r"-?[1-9][0-9]*", subject):
                subject_type = "account"
                subject_id = int(subject)
            else:
                match = re.fullmatch(r"(account|local):(-?[1-9][0-9]*)", subject)
                if match is None:
                    raise AppError("用户编号不正确")
                subject_type = match.group(1)
                subject_id = int(match.group(2))
        else:
            raise AppError("用户编号不正确")
        if subject_id == 0 or (subject_type == "local" and subject_id < 1):
            raise AppError("用户编号不正确")
        if limit < 1 or limit > 500:
            raise AppError("日志数量不正确")
        with self.connect() as connection:
            if subject_type == "local":
                identity = connection.execute(
                    "SELECT display_name FROM local_clients WHERE id = ?", (subject_id,)
                ).fetchone()
                state = "local" if identity is not None else "anonymized"
                where_clause = "local_client_id = ?"
            else:
                identity = connection.execute(
                    "SELECT display_name FROM users WHERE id = ?", (subject_id,)
                ).fetchone()
                state = "active"
                if identity is None:
                    identity = connection.execute(
                        """
                        SELECT display_name FROM archived_accounts
                        WHERE original_user_id = ? ORDER BY archived_at DESC LIMIT 1
                        """,
                        (subject_id,),
                    ).fetchone()
                    state = "archived" if identity is not None else "anonymized"
                where_clause = "user_id = ? AND local_client_id IS NULL"
            rows = connection.execute(
                f"""
                SELECT id, event_type, page_key, element_key, element_label,
                       target_page, occurred_at
                FROM behavior_events
                WHERE {where_clause} AND event_type IN ('page_view', 'click')
                ORDER BY id DESC LIMIT ?
                """,
                (subject_id, limit),
            ).fetchall()
        return {
            "subjectKey": f"{subject_type}:{subject_id}",
            "subjectType": subject_type,
            "subjectId": subject_id,
            "userId": subject_id,
            "displayName": identity["display_name"] if identity is not None else None,
            "state": state,
            "events": [
                {
                    "id": row["id"],
                    "eventType": row["event_type"],
                    "pageKey": row["page_key"],
                    "elementKey": row["element_key"],
                    "elementLabel": row["element_label"],
                    "targetPage": row["target_page"],
                    "occurredAt": row["occurred_at"],
                }
                for row in rows
            ],
        }

    def _snapshot_metadata(self, path: Path) -> dict | None:
        match = SNAPSHOT_ID_PATTERN.fullmatch(path.name)
        if match is None or not path.is_file():
            return None
        stat = path.stat()
        return {
            "id": path.name,
            "date": match.group("date"),
            "kind": match.group("kind"),
            "createdAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec="seconds"),
            "sizeBytes": stat.st_size,
        }

    def list_snapshots(self, limit: int | None = None) -> list[dict]:
        self.snapshot_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        snapshots = [
            metadata
            for path in self.snapshot_dir.glob("wcal-*.sqlite3.gz")
            if (metadata := self._snapshot_metadata(path)) is not None
        ]
        snapshots.sort(key=lambda item: (item["createdAt"], item["id"]), reverse=True)
        return snapshots if limit is None else snapshots[: max(1, limit)]

    def purge_expired_snapshots(self, now: datetime | None = None) -> int:
        current_date = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI).date()
        cutoff = current_date - timedelta(days=self.snapshot_retention_days - 1)
        removed = 0
        self.snapshot_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        for path in self.snapshot_dir.glob("wcal-*.sqlite3.gz"):
            match = SNAPSHOT_ID_PATTERN.fullmatch(path.name)
            if match is None:
                continue
            try:
                snapshot_date = date.fromisoformat(match.group("date"))
            except ValueError:
                continue
            if snapshot_date < cutoff:
                path.unlink(missing_ok=True)
                removed += 1
        return removed

    def create_snapshot(
        self,
        kind: str = "manual",
        now: datetime | None = None,
        *,
        replace: bool = False,
    ) -> dict:
        if kind not in {"daily", "manual", "pre-restore"}:
            raise AppError("快照类型不正确")
        snapshot_time = (now or datetime.now(SHANGHAI)).astimezone(SHANGHAI)
        date_part = snapshot_time.strftime("%Y-%m-%d")
        if kind == "daily":
            snapshot_id = f"wcal-{date_part}-daily.sqlite3.gz"
        else:
            time_part = snapshot_time.strftime("%H%M%S%f")
            snapshot_id = f"wcal-{date_part}T{time_part}-{kind}.sqlite3.gz"

        self.snapshot_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = self.snapshot_dir / snapshot_id
        if target.exists() and not replace:
            metadata = self._snapshot_metadata(target)
            if metadata is not None:
                return metadata

        token = secrets.token_hex(8)
        temporary_database = self.snapshot_dir / f".{snapshot_id}.{token}.sqlite3"
        temporary_archive = self.snapshot_dir / f".{snapshot_id}.{token}.tmp"
        try:
            with closing(sqlite3.connect(self.path, timeout=30)) as source:
                with closing(sqlite3.connect(temporary_database)) as destination:
                    source.backup(destination)
                    integrity = destination.execute("PRAGMA integrity_check").fetchone()[0]
                    if integrity != "ok":
                        raise AppError("数据库快照完整性检查失败")
            with temporary_database.open("rb") as source_file:
                with gzip.open(temporary_archive, "wb", compresslevel=6) as archive_file:
                    shutil.copyfileobj(source_file, archive_file)
            os.chmod(temporary_archive, 0o600)
            os.replace(temporary_archive, target)
        finally:
            temporary_database.unlink(missing_ok=True)
            temporary_archive.unlink(missing_ok=True)

        self.purge_expired_snapshots(snapshot_time)
        metadata = self._snapshot_metadata(target)
        if metadata is None:
            raise AppError("数据库快照创建失败")
        return metadata

    def _snapshot_path(self, snapshot_id: object) -> Path:
        if not isinstance(snapshot_id, str) or SNAPSHOT_ID_PATTERN.fullmatch(snapshot_id) is None:
            raise AppError("快照编号不正确")
        root = self.snapshot_dir.resolve()
        candidate = (root / snapshot_id).resolve()
        if candidate.parent != root or not candidate.is_file():
            raise AppError("快照不存在")
        return candidate

    def _read_user_from_snapshot(self, snapshot_path: Path, user_id: int) -> tuple[sqlite3.Row, list[sqlite3.Row]]:
        temporary_database = self.snapshot_dir / f".restore-{secrets.token_hex(12)}.sqlite3"
        try:
            with gzip.open(snapshot_path, "rb") as archive_file:
                with temporary_database.open("wb") as database_file:
                    shutil.copyfileobj(archive_file, database_file)
            os.chmod(temporary_database, 0o600)
            with closing(
                sqlite3.connect(f"file:{quote(str(temporary_database))}?mode=ro", uri=True)
            ) as connection:
                connection.row_factory = sqlite3.Row
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
                if integrity != "ok":
                    raise AppError("快照文件已损坏")
                user = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
                if user is None:
                    raise Conflict("该用户在所选快照中不存在")
                records = connection.execute(
                    """
                    SELECT record_date, weight_grams, created_at, updated_at
                    FROM weight_records WHERE user_id = ? ORDER BY record_date
                    """,
                    (user_id,),
                ).fetchall()
                return user, records
        except (gzip.BadGzipFile, OSError, sqlite3.DatabaseError) as error:
            raise AppError("快照文件无法读取") from error
        finally:
            temporary_database.unlink(missing_ok=True)

    def restore_user_from_snapshot(self, user_id: object, snapshot_id: object) -> dict:
        if isinstance(user_id, bool) or not isinstance(user_id, int) or user_id < 1:
            raise AppError("用户编号不正确")
        snapshot_path = self._snapshot_path(snapshot_id)
        snapshot_user, snapshot_records = self._read_user_from_snapshot(snapshot_path, user_id)
        with self.connect() as connection:
            current_user = connection.execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if current_user is None:
            raise Conflict("只能恢复当前正在使用的账户")

        safety_snapshot = self.create_snapshot("pre-restore")
        restored_at = iso_now()
        profile_columns = (
            "client_uid",
            "display_name",
            "theme",
            "font_style",
            "sound_enabled",
            "language",
            "unit",
            "height_cm",
            "body_fat_percent",
            "target_weight_grams",
            "target_body_fat_percent",
            "ai_report_json",
            "ai_report_signature",
            "ai_report_generated_at",
            "initial_weight_grams",
            "initial_date",
        )
        snapshot_columns = set(snapshot_user.keys())
        with self.connect() as connection:
            connection.execute(
                f"""
                UPDATE users SET
                    {", ".join(f"{column} = ?" for column in profile_columns)},
                    updated_at = ?
                WHERE id = ?
                """,
                tuple(snapshot_user[column] if column in snapshot_columns else None for column in profile_columns) + (restored_at, user_id),
            )
            connection.execute("DELETE FROM weight_records WHERE user_id = ?", (user_id,))
            connection.executemany(
                """
                INSERT INTO weight_records (
                    user_id, record_date, weight_grams, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                [
                    (
                        user_id,
                        row["record_date"],
                        row["weight_grams"],
                        row["created_at"],
                        row["updated_at"],
                    )
                    for row in snapshot_records
                ],
            )
        return {
            "ok": True,
            "userId": user_id,
            "snapshotId": snapshot_path.name,
            "restoredRecordCount": len(snapshot_records),
            "restoredAt": restored_at,
            "safetySnapshot": safety_snapshot,
        }

    def admin_dashboard(self) -> dict:
        now = utc_now()
        today_start = datetime.combine(now.astimezone(SHANGHAI).date(), datetime.min.time(), SHANGHAI).astimezone(timezone.utc)
        seven_days_ago = now - timedelta(days=7)
        with self.connect() as connection:
            users = connection.execute("SELECT * FROM users ORDER BY created_at DESC").fetchall()
            active_users = []
            for user in users:
                records = connection.execute(
                    """
                    SELECT record_date, weight_grams, created_at, updated_at
                    FROM weight_records WHERE user_id = ? ORDER BY record_date
                    """,
                    (user["id"],),
                ).fetchall()
                active_users.append(
                    {
                        "id": user["id"],
                        "userId": user["client_uid"] or f"cloud-{user['id']}",
                        "displayName": user["display_name"],
                        "passcode": self._decrypt_passcode(user["passcode_ciphertext"]),
                        "phoneLast4Required": bool(user["phone_last4_hash"]),
                        "theme": user["theme"],
                        "fontStyle": user["font_style"],
                        "soundEnabled": bool(user["sound_enabled"]),
                        "language": user["language"],
                        "unit": user["unit"],
                        "heightCm": user["height_cm"],
                        "bodyFatPercent": user["body_fat_percent"],
                        "targetWeightGrams": user["target_weight_grams"],
                        "targetBodyFatPercent": user["target_body_fat_percent"],
                        "aiReport": self._ai_report_from_row(user),
                        "initialWeightGrams": user["initial_weight_grams"],
                        "initialDate": user["initial_date"],
                        "createdAt": user["created_at"],
                        "updatedAt": user["updated_at"],
                        "records": [
                            {
                                "date": row["record_date"],
                                "weightGrams": row["weight_grams"],
                                "createdAt": row["created_at"],
                                "updatedAt": row["updated_at"],
                            }
                            for row in records
                        ],
                    }
                )
            local_rows = connection.execute(
                "SELECT * FROM local_clients ORDER BY updated_at DESC"
            ).fetchall()
            local_users = []
            for local_user in local_rows:
                try:
                    local_records = json.loads(local_user["records_json"])
                except (TypeError, json.JSONDecodeError):
                    local_records = []
                try:
                    local_report = json.loads(local_user["ai_report_json"]) if local_user["ai_report_json"] else None
                except (TypeError, json.JSONDecodeError):
                    local_report = None
                local_users.append(
                    {
                        "id": local_user["id"],
                        "userId": local_user["client_uid"],
                        "displayName": local_user["display_name"],
                        "theme": local_user["theme"],
                        "fontStyle": local_user["font_style"],
                        "soundEnabled": bool(local_user["sound_enabled"]),
                        "language": local_user["language"],
                        "unit": local_user["unit"],
                        "heightCm": local_user["height_cm"],
                        "bodyFatPercent": local_user["body_fat_percent"],
                        "targetWeightGrams": local_user["target_weight_grams"],
                        "targetBodyFatPercent": local_user["target_body_fat_percent"],
                        "aiReport": local_report,
                        "initialWeightGrams": local_user["initial_weight_grams"],
                        "initialDate": local_user["initial_date"],
                        "createdAt": local_user["created_at"],
                        "updatedAt": local_user["updated_at"],
                        "records": local_records if isinstance(local_records, list) else [],
                    }
                )
            archives = connection.execute(
                "SELECT * FROM archived_accounts ORDER BY archived_at DESC"
            ).fetchall()
            visits = connection.execute(
                """
                SELECT visitor_hash, ip_address, path, user_id, user_agent,
                       country_code, country, region, city, network, occurred_at
                FROM access_events ORDER BY occurred_at DESC LIMIT 80
                """
            ).fetchall()
            total_visits = connection.execute("SELECT COUNT(*) FROM access_events").fetchone()[0]
            visits_today = connection.execute(
                "SELECT COUNT(*) FROM access_events WHERE occurred_at >= ?",
                (today_start.isoformat(),),
            ).fetchone()[0]
            visits_seven_days = connection.execute(
                "SELECT COUNT(*) FROM access_events WHERE occurred_at >= ?",
                (seven_days_ago.isoformat(),),
            ).fetchone()[0]
            unique_seven_days = connection.execute(
                "SELECT COUNT(DISTINCT visitor_hash) FROM access_events WHERE occurred_at >= ?",
                (seven_days_ago.isoformat(),),
            ).fetchone()[0]
        archived_users = []
        for archive in archives:
            try:
                records = json.loads(archive["records_json"])
            except json.JSONDecodeError:
                records = []
            archived_users.append(
                {
                    "id": archive["id"],
                    "originalUserId": archive["original_user_id"],
                    "userId": archive["client_uid"] or f"cloud-{archive['original_user_id']}",
                    "displayName": archive["display_name"],
                    "passcode": self._decrypt_passcode(archive["passcode_ciphertext"]),
                    "phoneLast4Required": bool(archive["phone_last4_hash"]),
                    "theme": archive["theme"],
                    "fontStyle": archive["font_style"],
                    "soundEnabled": bool(archive["sound_enabled"]),
                    "language": archive["language"],
                    "unit": archive["unit"],
                    "heightCm": archive["height_cm"],
                    "bodyFatPercent": archive["body_fat_percent"],
                    "targetWeightGrams": archive["target_weight_grams"],
                    "targetBodyFatPercent": archive["target_body_fat_percent"],
                    "aiReport": self._ai_report_from_row(archive),
                    "initialWeightGrams": archive["initial_weight_grams"],
                    "initialDate": archive["initial_date"],
                    "createdAt": archive["account_created_at"],
                    "updatedAt": archive["account_updated_at"],
                    "archivedAt": archive["archived_at"],
                    "records": records,
                }
            )
        snapshots = self.list_snapshots()
        behavior_analytics = self.admin_behavior_analytics()
        return {
            "generatedAt": iso_now(),
            "stats": {
                "activeUsers": len(active_users),
                "localUsers": len(local_users),
                "archivedUsers": len(archived_users),
                "records": sum(len(user["records"]) for user in active_users + local_users),
                "visitsToday": visits_today,
                "visits7d": visits_seven_days,
                "uniqueVisitors7d": unique_seven_days,
                "totalVisits": total_visits,
            },
            "activeUsers": active_users,
            "localUsers": local_users,
            "archivedUsers": archived_users,
            "snapshots": snapshots,
            "snapshotPolicy": {
                "retentionDays": self.snapshot_retention_days,
                "count": len(snapshots),
                "totalSizeBytes": sum(snapshot["sizeBytes"] for snapshot in snapshots),
            },
            "analytics": behavior_analytics,
            "recentVisits": [
                {
                    "visitorId": row["visitor_hash"][:10],
                    "ipAddress": row["ip_address"],
                    "path": row["path"],
                    "userId": row["user_id"],
                    "userAgent": row["user_agent"],
                    "countryCode": row["country_code"],
                    "country": row["country"],
                    "region": row["region"],
                    "city": row["city"],
                    "network": row["network"],
                    "networkLabel": localize_network_label(row["network"]),
                    "occurredAt": row["occurred_at"],
                }
                for row in visits
            ],
        }

    def health(self) -> bool:
        try:
            with self.connect() as connection:
                value = connection.execute("SELECT 1").fetchone()[0]
            return value == 1
        except sqlite3.Error:
            return False


class SlidingRateLimiter:
    def __init__(self, limit: int = 8, window_seconds: int = 600):
        self.limit = limit
        self.window_seconds = window_seconds
        self._attempts: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            attempts = self._attempts[key]
            while attempts and attempts[0] <= now - self.window_seconds:
                attempts.popleft()
            if len(attempts) >= self.limit:
                raise RateLimited("尝试次数太多，请稍后再试")
            attempts.append(now)

    def clear(self, key: str) -> None:
        with self._lock:
            self._attempts.pop(key, None)


class WeightCalendarHandler(BaseHTTPRequestHandler):
    database: Database
    static_root: Path
    allowed_origin: str | None = None
    admin_password: str | None = None
    geo_locator = GeoLocator(None)
    ai_analyzer = DoubaoAnalyzer(None)
    production = False
    login_limiter = SlidingRateLimiter()
    admin_limiter = SlidingRateLimiter(limit=6, window_seconds=900)
    passcode_check_limiter = SlidingRateLimiter(limit=20, window_seconds=600)
    local_state_limiter = SlidingRateLimiter(limit=240, window_seconds=3600)
    local_behavior_limiter = SlidingRateLimiter(limit=1200, window_seconds=3600)

    server_version = "WeightCalendar/1.0"

    def log_message(self, message_format: str, *args) -> None:
        print(f"{self.log_date_time_string()} {self.client_address[0]} {message_format % args}")

    @property
    def client_ip(self) -> str:
        return normalize_ip(self.headers.get("X-Real-IP") or self.client_address[0])

    @property
    def client_key(self) -> str:
        return self.client_ip

    @property
    def request_language(self) -> str:
        return normalize_request_language(self.headers.get("Accept-Language"))

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        )

    def _send_json(self, status: int, payload: dict, extra_headers: dict[str, str] | None = None) -> None:
        data = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self._security_headers()
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(data)

    def _send_error(self, error: AppError) -> None:
        message = error.message
        if self.request_language != DEFAULT_LANGUAGE:
            message = ERROR_MESSAGES[self.request_language].get(error.code, ERROR_MESSAGES[self.request_language]["BAD_REQUEST"])
        self._send_json(error.status, {"ok": False, "code": error.code, "message": message})

    def _send_internal_error(self) -> None:
        message = "服务暂时不可用" if self.request_language == DEFAULT_LANGUAGE else ERROR_MESSAGES[self.request_language]["INTERNAL_ERROR"]
        self._send_json(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"ok": False, "code": "INTERNAL_ERROR", "message": message},
        )

    def _read_json(self) -> dict:
        content_type = self.headers.get("Content-Type", "")
        if "application/json" not in content_type:
            raise AppError("请求格式不正确")
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise AppError("请求长度不正确") from exc
        if length <= 0 or length > MAX_BODY_BYTES:
            raise AppError("请求内容过大或为空")
        try:
            payload = json.loads(self.rfile.read(length))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise AppError("JSON 格式不正确") from exc
        if not isinstance(payload, dict):
            raise AppError("请求内容必须是对象")
        return payload

    def _session_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("wcal_session")
        return morsel.value if morsel else None

    def _admin_token(self) -> str | None:
        cookie = SimpleCookie(self.headers.get("Cookie", ""))
        morsel = cookie.get("wcal_admin")
        return morsel.value if morsel else None

    def _require_user(self) -> int:
        return self.database.user_id_for_session(self._session_token())

    def _session_cookie(self, token: str) -> str:
        secure = "; Secure" if self.production else ""
        return (
            f"wcal_session={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={SESSION_DAYS * 86400}{secure}"
        )

    def _admin_cookie(self, token: str) -> str:
        secure = "; Secure" if self.production else ""
        return (
            f"wcal_admin={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={ADMIN_SESSION_HOURS * 3600}{secure}"
        )

    def _clear_cookie(self) -> str:
        secure = "; Secure" if self.production else ""
        return f"wcal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"

    def _clear_admin_cookie(self) -> str:
        secure = "; Secure" if self.production else ""
        return f"wcal_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{secure}"

    def _check_origin(self) -> None:
        origin = self.headers.get("Origin")
        if origin and self.allowed_origin and origin != self.allowed_origin:
            raise AppError("请求来源不被允许")

    def do_GET(self) -> None:
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/health":
                healthy = self.database.health()
                self._send_json(HTTPStatus.OK if healthy else HTTPStatus.SERVICE_UNAVAILABLE, {"ok": healthy, "database": healthy})
                return
            if parsed.path == "/api/me":
                token = self._session_token()
                user_id = self.database.user_id_for_session(token, renew=True)
                self._send_json(
                    HTTPStatus.OK,
                    self.database.payload(user_id),
                    {"Set-Cookie": self._session_cookie(token)},
                )
                return
            if parsed.path == "/api/account/security":
                self._send_json(HTTPStatus.OK, self.database.account_security(self._require_user()))
                return
            if parsed.path == "/api/export":
                payload = self.database.export_payload(self._require_user())
                filename = f"weight-records-{local_today().isoformat()}.json"
                data = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self._security_headers()
                self.end_headers()
                self.wfile.write(data)
                return
            if parsed.path == "/api/admin/dashboard":
                self.database.require_admin_session(self._admin_token())
                self._send_json(HTTPStatus.OK, self.database.admin_dashboard())
                return
            if parsed.path == "/api/admin/analytics/user":
                self.database.require_admin_session(self._admin_token())
                query = parse_qs(parsed.query)
                try:
                    limit = int(query.get("limit", ["300"])[0])
                except ValueError as error:
                    raise AppError("用户编号或日志数量不正确") from error
                subject = query.get("subject", query.get("userId", [""]))[0]
                self._send_json(
                    HTTPStatus.OK,
                    self.database.admin_user_journey(subject, limit),
                )
                return
            self._serve_static(parsed.path)
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()
            raise

    def do_POST(self) -> None:
        try:
            self._check_origin()
            payload = self._read_json()
            path = urlparse(self.path).path
            if path == "/api/admin/snapshots":
                self.database.require_admin_session(self._admin_token())
                snapshot = self.database.create_snapshot("manual")
                self._send_json(
                    HTTPStatus.CREATED,
                    {"ok": True, "snapshot": snapshot, "dashboard": self.database.admin_dashboard()},
                )
                return
            if path == "/api/admin/restore":
                self.database.require_admin_session(self._admin_token())
                if payload.get("confirmation") != "恢复":
                    raise AppError("请确认恢复操作")
                result = self.database.restore_user_from_snapshot(
                    payload.get("userId"), payload.get("snapshotId")
                )
                self._send_json(
                    HTTPStatus.OK,
                    {"ok": True, "restore": result, "dashboard": self.database.admin_dashboard()},
                )
                return
            if path == "/api/analytics/events":
                token = self._session_token()
                try:
                    user_id = self.database.user_id_for_session(token) if token else None
                except Unauthorized:
                    user_id = None
                if user_id is not None and token is not None:
                    accepted = self.database.record_behavior_events(
                        user_id,
                        token,
                        payload.get("events"),
                    )
                else:
                    self.local_behavior_limiter.check(f"local-behavior:{self.client_key}")
                    accepted = self.database.record_local_behavior_events(
                        payload.get("clientUid"), payload.get("events")
                    )
                self._send_json(HTTPStatus.ACCEPTED, {"ok": True, "accepted": accepted})
                return
            if path == "/api/local/state":
                self.local_state_limiter.check(f"local-state:{self.client_key}")
                result = self.database.upsert_local_client(
                    payload.get("clientUid"), payload.get("clientData")
                )
                self._send_json(HTTPStatus.ACCEPTED, result)
                return
            if path == "/api/visits":
                user_id = None
                try:
                    user_id = self.database.user_id_for_session(self._session_token())
                except Unauthorized:
                    pass
                client_ip = self.client_ip
                location = self.database.cached_ip_location(client_ip)
                if location is None:
                    location = self.geo_locator.locate(client_ip)
                    self.database.cache_ip_location(client_ip, location)
                self.database.record_visit(
                    client_ip,
                    payload.get("path"),
                    self.headers.get("User-Agent"),
                    user_id,
                    location,
                )
                self._send_json(HTTPStatus.CREATED, {"ok": True})
                return
            if path == "/api/ai-analysis":
                user_id = self._require_user()
                profile = self.database.set_health_profile(
                    user_id,
                    payload.get("heightCm"),
                    payload.get("bodyFatPercent"),
                    payload.get("targetWeightGrams"),
                    payload.get("targetBodyFatPercent"),
                )
                remaining = self.database.consume_ai_daily_quota(f"cloud:{user_id}")
                result = self.ai_analyzer.analyze(
                    self.database.health_context(user_id),
                    profile["account"]["heightCm"],
                    profile["account"]["bodyFatPercent"],
                    profile["account"]["language"],
                )
                saved_profile = self.database.set_ai_report(user_id, result, payload.get("inputSignature"))
                result["account"] = saved_profile["account"]
                result["remainingAnalysesToday"] = remaining
                self._send_json(HTTPStatus.OK, result)
                return
            if path == "/api/ai-analysis/local":
                client_data = payload.get("clientData")
                if not isinstance(client_data, dict):
                    raise AppError("本地数据格式不正确")
                account = client_data.get("account")
                if not isinstance(account, dict):
                    account = {}
                client_uid = validate_client_uid(account.get("userId"))
                height_cm, body_fat_percent = validate_health_profile(
                    payload.get("heightCm"),
                    payload.get("bodyFatPercent"),
                )
                target_weight_grams, target_body_fat_percent = validate_goal_profile(
                    payload.get("targetWeightGrams"),
                    payload.get("targetBodyFatPercent"),
                )
                records = sanitize_client_records(client_data.get("records"))
                language = validate_language(
                    payload.get("language")
                    or account.get("language")
                    or self.request_language
                )
                health_context = build_health_context(
                    records,
                    total_record_count=len(records),
                    current_body_fat_percent=body_fat_percent,
                    target_weight_grams=target_weight_grams,
                    target_body_fat_percent=target_body_fat_percent,
                )
                remaining = self.database.consume_ai_daily_quota(
                    f"local:{client_uid or self.client_key}"
                )
                result = self.ai_analyzer.analyze(
                    health_context,
                    height_cm,
                    body_fat_percent,
                    language,
                )
                signature = validate_optional_signature(payload.get("inputSignature"))
                result["inputSignature"] = signature
                result["generatedAt"] = iso_now()
                result["remainingAnalysesToday"] = remaining
                self._send_json(HTTPStatus.OK, result)
                return
            if path == "/api/accounts/check-passcode":
                self.passcode_check_limiter.check(f"passcode-check:{self.client_key}")
                available = self.database.passcode_available(payload.get("passcode"))
                self._send_json(HTTPStatus.OK, {"ok": True, "available": available})
                return
            if path == "/api/accounts":
                self.login_limiter.check(f"create:{self.client_key}")
                supplied_phone_last4 = payload.get("phoneLast4")
                phone_last4 = validate_phone_last4(supplied_phone_last4) if supplied_phone_last4 else None
                client_data = payload.get("clientData")
                account = client_data.get("account") if isinstance(client_data, dict) else {}
                if not isinstance(account, dict):
                    account = {}
                user_id = self.database.create_account(
                    payload.get("passcode"),
                    payload.get("displayName"),
                    payload.get("language", DEFAULT_LANGUAGE),
                    phone_last4,
                    account.get("userId"),
                    account.get("createdAt"),
                )
                if client_data is not None:
                    self.database.merge_client_data(user_id, client_data, "local")
                token = self.database.create_session(user_id)
                self._send_json(HTTPStatus.CREATED, self.database.payload(user_id), {"Set-Cookie": self._session_cookie(token)})
                return
            if path == "/api/sessions":
                limiter_key = f"login:{self.client_key}"
                self.login_limiter.check(limiter_key)
                user_id = self.database.authenticate(payload.get("passcode"), payload.get("phoneLast4"))
                token = self.database.create_session(user_id)
                self.login_limiter.clear(limiter_key)
                self._send_json(HTTPStatus.OK, self.database.payload(user_id), {"Set-Cookie": self._session_cookie(token)})
                return
            if path == "/api/admin/session":
                limiter_key = f"admin:{self.client_key}"
                self.admin_limiter.check(limiter_key)
                supplied = payload.get("password")
                configured = self.admin_password or ""
                if not isinstance(supplied, str) or not configured or not hmac.compare_digest(supplied, configured):
                    raise InvalidCredentials("管理密码不正确")
                token = self.database.create_admin_session()
                self.admin_limiter.clear(limiter_key)
                self._send_json(
                    HTTPStatus.OK,
                    self.database.admin_dashboard(),
                    {"Set-Cookie": self._admin_cookie(token)},
                )
                return
            raise AppError("接口不存在")
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()
            raise

    def do_PUT(self) -> None:
        try:
            self._check_origin()
            user_id = self._require_user()
            payload = self._read_json()
            if self.path == "/api/profile":
                result = self.database.set_initial(user_id, payload.get("date"), payload.get("weightGrams"))
            elif self.path == "/api/records":
                weight_grams = payload.get("weightGrams")
                if isinstance(weight_grams, int) and not isinstance(weight_grams, bool) and weight_grams == 0:
                    result = self.database.delete_record(user_id, payload.get("date"))
                else:
                    result = self.database.upsert_record(user_id, payload.get("date"), weight_grams)
            elif self.path == "/api/theme":
                result = self.database.set_theme(user_id, payload.get("theme"))
            elif self.path == "/api/font":
                result = self.database.set_font_style(user_id, payload.get("fontStyle"))
            elif self.path == "/api/sound":
                result = self.database.set_sound_enabled(user_id, payload.get("soundEnabled"))
            elif self.path == "/api/language":
                result = self.database.set_language(user_id, payload.get("language"))
            elif self.path == "/api/unit":
                result = self.database.set_weight_unit(user_id, payload.get("unit"))
            elif self.path == "/api/display-name":
                result = self.database.set_display_name(user_id, payload.get("displayName"))
            elif self.path == "/api/passcode":
                limiter_key = f"passcode-change:{user_id}"
                self.login_limiter.check(limiter_key)
                result = self.database.change_passcode(user_id, payload.get("newPasscode"))
                self.login_limiter.clear(limiter_key)
            elif self.path == "/api/phone-last4":
                limiter_key = f"phone-last4-change:{user_id}"
                self.login_limiter.check(limiter_key)
                result = self.database.change_phone_last4(user_id, payload.get("phoneLast4"))
                self.login_limiter.clear(limiter_key)
            elif self.path == "/api/sync/merge":
                result = self.database.merge_client_data(
                    user_id,
                    payload.get("clientData"),
                    payload.get("precedence", "local"),
                )
            else:
                raise AppError("接口不存在")
            self._send_json(HTTPStatus.OK, result)
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()
            raise

    def do_DELETE(self) -> None:
        try:
            self._check_origin()
            path = urlparse(self.path).path
            if path == "/api/sessions":
                self.database.delete_session(self._session_token())
                self._send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": self._clear_cookie()})
                return
            if path == "/api/admin/session":
                self.database.delete_admin_session(self._admin_token())
                self._send_json(HTTPStatus.OK, {"ok": True}, {"Set-Cookie": self._clear_admin_cookie()})
                return
            if path == "/api/account":
                user_id = self._require_user()
                payload = self._read_json()
                limiter_key = f"delete:{self.client_key}"
                self.login_limiter.check(limiter_key)
                self.database.verify_passcode(user_id, payload.get("passcode"))
                result = self.database.archive_account(user_id)
                self.login_limiter.clear(limiter_key)
                self._send_json(HTTPStatus.OK, result, {"Set-Cookie": self._clear_cookie()})
                return
            raise AppError("接口不存在")
        except AppError as error:
            self._send_error(error)
        except Exception:
            self._send_internal_error()
            raise

    def _serve_static(self, request_path: str) -> None:
        relative = unquote(request_path).lstrip("/") or "index.html"
        candidate = (self.static_root / relative).resolve()
        root = self.static_root.resolve()
        try:
            candidate.relative_to(root)
        except ValueError:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if not candidate.is_file():
            candidate = root / "index.html"
        if not candidate.is_file():
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        mime_type, _ = mimetypes.guess_type(candidate.name)
        if candidate.suffix == ".webmanifest":
            mime_type = "application/manifest+json"
        data = candidate.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", f"{mime_type or 'application/octet-stream'}" + ("; charset=utf-8" if candidate.suffix in {".html", ".js", ".css", ".json", ".svg"} else ""))
        self.send_header("Content-Length", str(len(data)))
        if candidate.name == "index.html":
            self.send_header("Cache-Control", "no-store, must-revalidate")
        elif candidate.parent.name == "assets":
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        else:
            self.send_header("Cache-Control", "public, max-age=3600")
        self._security_headers()
        self.end_headers()
        self.wfile.write(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Weight Calendar web server")
    parser.add_argument("port", nargs="?", type=int, default=int(os.environ.get("WCAL_PORT", "8141")))
    parser.add_argument("root", nargs="?", default=os.environ.get("WCAL_STATIC_ROOT", "dist"))
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    secret = os.environ.get("WCAL_SECRET", "development-only-secret-change-before-production")
    database_path = os.environ.get("WCAL_DB_PATH", "data/wcal.sqlite3")
    snapshot_dir = os.environ.get("WCAL_SNAPSHOT_DIR")
    try:
        snapshot_retention_days = int(
            os.environ.get("WCAL_SNAPSHOT_RETENTION_DAYS", str(DEFAULT_SNAPSHOT_RETENTION_DAYS))
        )
    except ValueError as error:
        raise RuntimeError("WCAL_SNAPSHOT_RETENTION_DAYS must be an integer") from error
    allowed_origin = os.environ.get("WCAL_ALLOWED_ORIGIN")
    admin_password = os.environ.get("WCAL_ADMIN_PASSWORD")
    ark_api_key = os.environ.get("ARK_API_KEY")
    ark_model = os.environ.get("WCAL_ARK_MODEL", DEFAULT_ARK_MODEL)
    geoip_endpoint = os.environ.get("WCAL_GEOIP_ENDPOINT", "https://ipwho.is/{ip}")
    production = os.environ.get("APP_ENV") == "production"
    if production and secret.startswith("development-only"):
        raise RuntimeError("WCAL_SECRET is required in production")
    if production and not admin_password:
        raise RuntimeError("WCAL_ADMIN_PASSWORD is required in production")
    database = Database(
        database_path,
        secret,
        snapshot_dir=snapshot_dir,
        snapshot_retention_days=snapshot_retention_days,
    )
    WeightCalendarHandler.database = database
    WeightCalendarHandler.static_root = Path(args.root)
    WeightCalendarHandler.allowed_origin = allowed_origin
    WeightCalendarHandler.admin_password = admin_password
    WeightCalendarHandler.geo_locator = GeoLocator(geoip_endpoint)
    WeightCalendarHandler.ai_analyzer = DoubaoAnalyzer(ark_api_key, ark_model)
    WeightCalendarHandler.production = production
    server = ThreadingHTTPServer(("127.0.0.1", args.port), WeightCalendarHandler)
    maintenance_stop = threading.Event()

    def run_maintenance() -> None:
        while True:
            try:
                database.purge_expired_archived_accounts()
                database.create_snapshot("daily")
                database.purge_expired_snapshots()
            except Exception as error:
                print(f"Database maintenance failed: {error}")
            if maintenance_stop.wait(60 * 60):
                return

    maintenance_thread = threading.Thread(
        target=run_maintenance,
        name="wcal-database-maintenance",
        daemon=True,
    )
    maintenance_thread.start()
    print(f"Weight Calendar listening on http://127.0.0.1:{args.port}")
    try:
        server.serve_forever()
    finally:
        maintenance_stop.set()
        server.server_close()


if __name__ == "__main__":
    main()
