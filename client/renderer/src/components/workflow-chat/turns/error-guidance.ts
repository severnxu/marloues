export interface ErrorGuidance {
  title: string;
  summary: string;
  actions: string[];
  toolHint?: string;
}

export function classifyError(message: string): ErrorGuidance {
  const text = message.toLowerCase();

  if (
    /2056|usage limit exceeded|token plan|insufficient balance|1008|quota|billing|balance/.test(
      text,
    )
  ) {
    return {
      title: "Token Plan 不可用",
      summary: "模型端点已响应，但当前账号没有可用的生成资源。",
      actions: [
        "续费或等待资源窗口恢复。",
        "临时切换到仍有额度的模型或 provider。",
        "在设置里测试当前 Endpoint，确认恢复后再重试。",
      ],
    };
  }

  if (
    /invalid setting source|process exited with code 1|setting source/.test(
      text,
    )
  ) {
    return {
      title: "Agent 启动失败",
      summary:
        "子进程在进入对话前退出，通常是启动参数或本地配置不被运行时接受。",
      actions: [
        "查看诊断包里的 runtime stderr。",
        "临时关闭最近新增的 MCP 服务后重试。",
        "确认运行配置只使用当前 runtime 支持的设置来源。",
      ],
      toolHint: "如果刚改过策略或配置合并逻辑，先跑一次 runtime smoke test。",
    };
  }

  if (
    /401|403|unauthorized|forbidden|auth|api key|permission|credential/.test(
      text,
    )
  ) {
    return {
      title: "网关鉴权失败",
      summary: "模型端点可达，但当前凭据或权限没有通过。",
      actions: [
        "检查当前 Endpoint Profile 的 Base URL 和 Token。",
        "确认网关侧已给当前模型和账号授权。",
        "切换到测试 provider，验证是否为单端点问题。",
      ],
    };
  }

  if (/model|not found|does not exist|unknown model/.test(text)) {
    return {
      title: "模型不可用",
      summary: "请求已到达 provider，但模型 ID 或路由目标不匹配。",
      actions: [
        "核对默认模型 ID 是否与网关声明一致。",
        "在模型选择器里切换到可用模型后重试。",
        "让网关侧确认该模型已发布到当前环境。",
      ],
    };
  }

  if (
    /mcp|tools\/list|initialize|json-rpc|enoent|timed out|timeout|spawn/.test(
      text,
    )
  ) {
    return {
      title: "MCP 工具启动异常",
      summary: "工具服务没有按预期完成初始化或返回结果。",
      actions: [
        "检查 MCP 命令、参数和工作目录。",
        "确认工具只在 stdout 输出 MCP 协议内容。",
        "先禁用异常 MCP，再逐个恢复验证。",
      ],
      toolHint: "右侧任务面板会显示最近工具调用和错误输出。",
    };
  }

  if (/workspace|cwd|directory|path/.test(text)) {
    return {
      title: "工作区不可用",
      summary: "当前任务需要一个可访问的本地目录。",
      actions: [
        "先选择一个项目工作区。",
        "确认目录仍存在，并且当前用户有读写权限。",
        "如果路径里有特殊字符，换一个简单路径复测。",
      ],
    };
  }

  return {
    title: "本轮执行失败",
    summary: "Agent 返回了错误信息，需要结合上下文继续排查。",
    actions: [],
  };
}

export function splitErrorPrimary(message: string): string {
  const normalized = message.trim();
  const [primary] = normalized.split(/\n\s*\n/);
  return primary?.trim() ?? normalized;
}
