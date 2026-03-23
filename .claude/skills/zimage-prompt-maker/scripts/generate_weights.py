#!/usr/bin/env python3
"""
随机种子生成脚本
生成5组随机整数数组，每组10个随机整数（范围：0-100）
作为Verbalized Sampling的显式采样，引导AI生成多样化的提示词变体
"""
import json
import random
from typing import List

def generate_random_arrays(num_groups: int = 5, array_size: int = 10, range_max: int = 100) -> List[List[int]]:
    """
    生成随机数数组

    Args:
        num_groups: 组数，默认5
        array_size: 每组数组大小，默认10
        range_max: 随机数范围上限，默认100

    Returns:
        5组随机整数数组
    """
    random.seed()  # 使用系统时间作为随机种子
    groups = []
    for _ in range(num_groups):
        group = [random.randint(0, range_max) for _ in range(array_size)]
        groups.append(group)
    return groups

def arrays_to_json(num_groups: int = 5) -> str:
    """生成JSON格式的随机种子数组"""
    groups = generate_random_arrays(num_groups)
    result = {
        "groups": groups,
        "note": "每组10个随机种子值，范围0-100，用于引导生成5条独立的提示词变体路径"
    }
    return json.dumps(result, ensure_ascii=False, indent=2)

if __name__ == "__main__":
    print(arrays_to_json())
