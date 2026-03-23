#!/usr/bin/env python3
"""
ComfyUI 图片生成脚本 - NanoClaw Discord 版本
使用 Z-Image 工作流模板

服务器配置:
- COMFYUI_MODE=internal (默认) -> 192.168.31.8:7860
- COMFYUI_MODE=external -> 123.56.194.98:7860
- 或直接设置 COMFYUI_SERVER 指定服务器地址
"""

import os
import sys
import json
import time
import requests
from pathlib import Path
from typing import Dict, Any, Optional

# ComfyUI 服务器配置
COMFYUI_INTERNAL = "192.168.31.8:7860"
COMFYUI_EXTERNAL = "123.56.194.98:7860"

def get_comfyui_server() -> str:
    """获取 ComfyUI 服务器地址"""
    # 直接指定服务器
    if os.environ.get("COMFYUI_SERVER"):
        return os.environ["COMFYUI_SERVER"]

    # 根据模式选择服务器（默认使用内网）
    mode = os.environ.get("COMFYUI_MODE", "internal")
    if mode == "external":
        print(f"[ComfyUI] 使用外网服务器: {COMFYUI_EXTERNAL}", file=sys.stderr)
        return COMFYUI_EXTERNAL
    else:
        print(f"[ComfyUI] 使用内网服务器: {COMFYUI_INTERNAL}", file=sys.stderr)
        return COMFYUI_INTERNAL


def load_workflow_template() -> Dict[str, Any]:
    """加载工作流模板"""
    script_dir = Path(__file__).parent.resolve()
    template_path = script_dir / "template.json"

    with open(template_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_workflow(
    template: Dict[str, Any],
    prompt: str,
    width: int = 512,
    height: int = 1024,
    seed: Optional[int] = None,
) -> Dict[str, Any]:
    """构建工作流 JSON"""
    if seed is None:
        seed = int(time.time() * 1000) % 1000000000

    replacements = {
        "${提示词}": prompt.replace('"', '\\"').replace("\n", " ").replace("\r", " ").replace("\t", " "),
        "${宽}": str(width),
        "${高}": str(height),
        "${种子}": str(seed),
    }

    def replace_recursively(obj: Any) -> Any:
        if isinstance(obj, str):
            for placeholder, value in replacements.items():
                if placeholder in obj:
                    return obj.replace(placeholder, value)
            return obj
        elif isinstance(obj, dict):
            return {k: replace_recursively(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [replace_recursively(item) for item in obj]
        else:
            return obj

    return replace_recursively(template)


def submit_prompt(server_address: str, workflow: Dict[str, Any]) -> str:
    """提交任务到 ComfyUI"""
    import datetime
    client_id = f"nanoclaw_{datetime.datetime.now().timestamp()}"

    response = requests.post(
        f"http://{server_address}/prompt",
        json={"prompt": workflow, "client_id": client_id},
        timeout=30
    )
    response.raise_for_status()
    result = response.json()

    prompt_id = result.get("prompt_id")
    if not prompt_id:
        raise Exception(f"未能获取 prompt_id，服务器响应: {result}")

    return prompt_id


def wait_for_result(server_address: str, prompt_id: str, timeout: int = 300) -> Dict[str, Any]:
    """轮询等待生成完成"""
    max_attempts = timeout // 2

    for attempt in range(max_attempts):
        try:
            history_resp = requests.get(
                f"http://{server_address}/history/{prompt_id}"
            )

            if history_resp.status_code == 200:
                history = history_resp.json()
                if prompt_id in history:
                    return history[prompt_id]
        except Exception as e:
            print(f"  查询状态时出错: {e}", file=sys.stderr)

        time.sleep(2)
        print(f"[ComfyUI] 等待生成中... ({attempt+1}/{max_attempts})", file=sys.stderr)

    raise Exception("图片生成超时")


def download_images(
    server_address: str,
    result: Dict[str, Any],
    output_path: Path,
) -> str:
    """下载并保存图片"""
    outputs = result.get("outputs", {})

    output_path.mkdir(parents=True, exist_ok=True)

    for node_id, node_data in outputs.items():
        if "images" in node_data:
            for img_item in node_data["images"]:
                filename = img_item["filename"]
                subfolder = img_item.get("subfolder", "")
                img_type = img_item.get("type", "output")

                view_url = f"http://{server_address}/view?filename={filename}&subfolder={subfolder}&type={img_type}"

                img_res = requests.get(view_url)
                if img_res.status_code == 200:
                    timestamp = int(time.time())
                    ext = Path(filename).suffix or ".jpg"
                    save_path = output_path / f"{timestamp}{ext}"

                    with open(save_path, "wb") as f:
                        f.write(img_res.content)

                    return str(save_path)

    return None


def generate_image(
    prompt: str,
    server_address: str = "123.56.194.98:7860",
    width: int = 512,
    height: int = 1024,
    seed: Optional[int] = None,
) -> str:
    """
    生成单张图片

    Args:
        prompt: 提示词
        server_address: ComfyUI服务器地址
        width: 图片宽度
        height: 图片高度
        seed: 随机种子

    Returns:
        保存的图片路径
    """
    print(f"[ComfyUI] 正在连接服务器: {server_address}", file=sys.stderr)
    print(f"[ComfyUI] 提示词: {prompt[:50]}...", file=sys.stderr)

    # 加载工作流模板
    template = load_workflow_template()

    # 构建工作流
    workflow = build_workflow(
        template=template,
        prompt=prompt,
        width=width,
        height=height,
        seed=seed,
    )

    # 提交任务
    prompt_id = submit_prompt(server_address, workflow)
    print(f"[ComfyUI] 任务已提交, ID: {prompt_id}", file=sys.stderr)

    # 等待结果
    result = wait_for_result(server_address, prompt_id)
    print(f"[ComfyUI] 生成完成，开始下载图片", file=sys.stderr)

    # 下载图片 - 保存到共享目录
    output_dir = Path("/workspace/group/images")
    saved_path = download_images(server_address, result, output_dir)

    if saved_path:
        print(f"[ComfyUI] 图片已保存: {saved_path}", file=sys.stderr)
        return saved_path
    else:
        raise Exception("未能下载生成的图片")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python3 generate_comfyui.py <提示词>", file=sys.stderr)
        print("环境变量:", file=sys.stderr)
        print("  COMFYUI_MODE=internal  使用内网服务器 (默认, 192.168.31.8:7860)", file=sys.stderr)
        print("  COMFYUI_MODE=external  使用外网服务器 (123.56.194.98:7860)", file=sys.stderr)
        print("  COMFYUI_SERVER=地址    直接指定服务器地址", file=sys.stderr)
        sys.exit(1)

    prompt = sys.argv[1]
    server = get_comfyui_server()
    width = int(os.environ.get("COMFYUI_WIDTH", "512"))
    height = int(os.environ.get("COMFYUI_HEIGHT", "1024"))

    try:
        path = generate_image(prompt, server, width, height)
        print(path)  # 输出路径供 Node.js 捕获
    except Exception as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)
