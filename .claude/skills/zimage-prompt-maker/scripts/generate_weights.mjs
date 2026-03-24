#!/usr/bin/env node
/**
 * 随机种子生成脚本
 * 生成指定组数的随机整数数组，每组10个随机整数（范围：0-100）
 *
 * 用法: node generate_weights.mjs [组数]
 * 默认生成1组
 */

function generateRandomArrays(numGroups = 1, arraySize = 10, rangeMax = 100) {
  const groups = [];
  for (let i = 0; i < numGroups; i++) {
    const group = [];
    for (let j = 0; j < arraySize; j++) {
      group.push(Math.floor(Math.random() * (rangeMax + 1)));
    }
    groups.push(group);
  }
  return groups;
}

// 从命令行参数获取组数，默认1
const args = process.argv.slice(2);
const numGroups = args.length > 0 ? parseInt(args[0], 10) : 1;
const validNum = isNaN(numGroups) || numGroups < 1 ? 1 : Math.min(numGroups, 10);

const groups = generateRandomArrays(validNum);
const result = {
  groups,
  numGroups: validNum,
  note: `生成${validNum}组提示词的随机种子，每组10个随机整数（范围0-100）`,
};
console.log(JSON.stringify(result, null, 2));
