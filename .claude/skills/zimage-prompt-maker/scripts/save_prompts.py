#!/usr/bin/env python3
"""
提示词保存脚本
将生成的提示词保存到 .txt 文件
"""
import os
import sys
import json
import argparse
from datetime import datetime
from typing import Dict, List


def get_script_dir():
    """获取脚本所在目录"""
    return os.path.dirname(os.path.abspath(__file__))


def sanitize_filename(filename: str) -> str:
    """清理文件名，移除非法字符"""
    # 替换非法字符为下划线
    invalid_chars = '<>:"/\\|?*'
    for char in invalid_chars:
        filename = filename.replace(char, '_')
    return filename


def generate_filename(theme: str) -> str:
    """生成文件名"""
    # 清理主题名称
    clean_theme = sanitize_filename(theme)
    # 生成时间戳
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    # 组合文件名
    return f"prompts_{clean_theme}_{timestamp}.txt"


def format_prompts_text(theme: str, prompts_data: List[Dict]) -> str:
    """格式化提示词为文本"""
    lines = []
    lines.append("Z-Image 提示词生成结果")
    lines.append(f"生成时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    lines.append(f"主题：{theme}")
    lines.append("=" * 50)
    lines.append("")

    for i, prompt_data in enumerate(prompts_data, 1):
        seed = prompt_data.get('seed', [])
        content = prompt_data.get('content', '')

        lines.append(f"【提示词组 {i}】")
        lines.append(f"种子数组：{seed}")
        lines.append("")
        lines.append(content)
        lines.append("")
        lines.append("=" * 50)
        lines.append("")

    return '\n'.join(lines)


def save_prompts_to_file(theme: str, prompts_data: List[Dict], output_path: str = None) -> str:
    """
    保存提示词到文件

    Args:
        theme: 提示词主题
        prompts_data: 提示词数据列表，每个元素包含 seed 和 content
        output_path: 输出文件路径（可选）

    Returns:
        保存的文件路径
    """
    # 如果未指定输出路径，自动生成
    if output_path is None:
        filename = generate_filename(theme)
        # 保存到用户主目录
        output_path = os.path.join(os.path.expanduser('~'), filename)

    # 格式化内容
    content = format_prompts_text(theme, prompts_data)

    # 写入文件
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)

    return output_path


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='保存 Z-Image 提示词到文件')
    parser.add_argument('--theme', type=str, required=True, help='提示词主题')
    parser.add_argument('--prompts', type=str, required=True, help='JSON格式的提示词数据')
    parser.add_argument('--output', type=str, help='输出文件路径（可选）')

    args = parser.parse_args()

    try:
        # 解析 JSON 数据
        prompts_json = json.loads(args.prompts)

        # 支持两种 JSON 格式
        if 'prompts' in prompts_json:
            # 格式：{"theme": "...", "prompts": [...]}
            prompts_data = prompts_json['prompts']
            theme = prompts_json.get('theme', args.theme)
        else:
            # 格式：直接是提示词数组
            prompts_data = prompts_json
            theme = args.theme

        # 验证数据格式
        if not isinstance(prompts_data, list):
            print("错误：prompts 必须是数组格式", file=sys.stderr)
            sys.exit(1)

        for prompt in prompts_data:
            if 'seed' not in prompt or 'content' not in prompt:
                print("错误：每个提示词必须包含 'seed' 和 'content' 字段", file=sys.stderr)
                sys.exit(1)

        # 保存到文件
        output_path = save_prompts_to_file(theme, prompts_data, args.output)

        print(f"✓ 提示词已保存到：{output_path}")

    except json.JSONDecodeError as e:
        print(f"错误：JSON 格式无效 - {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误：{e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
