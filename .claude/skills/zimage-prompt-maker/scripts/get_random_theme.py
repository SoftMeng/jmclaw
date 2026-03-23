#!/usr/bin/env python3
"""
主题库随机选择脚本
从themes.txt中随机选择一行作为主题
"""
import os
import random
import json

def get_script_dir():
    """获取脚本所在目录"""
    return os.path.dirname(os.path.abspath(__file__))

def load_themes():
    """加载主题库"""
    script_dir = get_script_dir()
    # 相对于脚本目录查找data/themes.txt
    themes_file = os.path.join(os.path.dirname(script_dir), 'data', 'themes.txt')

    if not os.path.exists(themes_file):
        # 如果不存在，返回默认主题
        return ["未来城市", "星空下的古老城堡", "梦幻森林"]

    with open(themes_file, 'r', encoding='utf-8') as f:
        themes = [line.strip() for line in f if line.strip()]
    return themes

def get_random_theme():
    """随机获取一个主题"""
    themes = load_themes()
    return random.choice(themes)

def main():
    """主函数"""
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == '--json':
        # JSON格式输出（包含主题列表）
        themes = load_themes()
        result = {
            "random_theme": get_random_theme(),
            "total_themes": len(themes)
        }
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        # 简单输出主题
        print(get_random_theme())

if __name__ == "__main__":
    main()
