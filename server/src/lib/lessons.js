/**
 * 课程内容生成器。
 * 现有目录只有课程名/方向/课时，没有真实视频与讲义；
 * 这里按方向知识图谱生成「章 → 节 → 讲义」，保证「付费后能真实学习」成立。
 * 后续接真实课程时，可直接替换 lessons 表中的 body，或改为对接对象存储的视频地址。
 */

export const TOPIC = {
  '数字化转型': ['数据治理体系', '数据架构设计', '数据资产与指标', '业务分析模型', '数字化规划方法', '数据中台实践', '治理落地与运营'],
  '国家软考': ['考试大纲与知识地图', '项目管理知识域', '架构与设计方法', '案例分析与计算题', '论文写作框架', '真题拆解', '冲刺与应试策略'],
  '产品研发': ['需求洞察与分析', '产品设计与原型', '技术实现与选型', '开发协作流程', '质量与测试', '架构与重构', '上线与迭代'],
  '信息安全': ['安全基础与模型', '密码与身份认证', '网络攻防原理', '渗透测试方法', '数据安全与合规', '安全运营中心', '应急响应'],
  '信创 + 运维': ['操作系统与内核', '网络协议与架构', '容器与云原生', '数据库运维', '高可用与容灾', '监控与自动化', '故障排查'],
  '项目管理': ['项目启动与章程', '范围与进度管理', '质量与风险管理', '沟通与干系人', '敏捷与迭代', '收尾与复盘', '项目组合管理'],
  '人工智能': ['机器学习基础', '深度学习与网络', '自然语言处理', '计算机视觉', '大模型与 Agent', '提示工程', 'RAG 与微调'],
  '综合': ['工具与平台入门', '数据与分析', '数据库管理', '云计算与虚拟化', '网络与物联', '效率方法', '综合案例']
};

function lessonBody(title, topic, index) {
  const focus = ['为什么学这一节', '关键概念拆解', '上手实操路径', '常见误区与自查'][index % 4];
  return [
    `本节围绕《${title}》中的「${topic}」展开，重点解决${focus}的问题。`,
    `先把概念说清楚：「${topic}」不是孤立的技巧，而是一套可复用的工作方法。学习时建议边看边画出流程，把抽象概念落到具体步骤上。`,
    '实操建议：找一个与你工作相关的真实场景，按「输入—处理—输出」三段拆解，用本节的方法完整走一遍。遇到卡点先记录下来，不必一次做对。',
    '自查清单：① 能否用自己的话复述核心概念？② 能否在 5 分钟内举出一个应用例子？③ 是否知道下一步该练什么？三项都能答，再进入下一节。'
  ];
}

/**
 * @param {string} key 课程 key
 * @param {{title:string, field:string, hours:number}} course
 * @returns {Array<{chapterNo:number, chapterTitle:string, lessons:Array}>}
 */
export function buildLessons(key, course) {
  const topics = TOPIC[course.field] || TOPIC['综合'];
  const count = Math.max(3, Math.min(9, Math.round((course.hours || 8) / 2)));
  const stages = ['核心概念', '方法与实操', '案例与练习'];
  const chapters = [];

  for (let i = 0; i < count; i++) {
    const topic = topics[i % topics.length];
    const lessonCount = 2 + (i % 2);
    const lessons = [];
    for (let j = 0; j < lessonCount; j++) {
      lessons.push({
        chapterNo: i + 1,
        lessonNo: j + 1,
        chapterTitle: `第${i + 1}章 ${topic}`,
        lessonKey: `${key}|${i}-${j}`,
        title: `${topic} · ${stages[j % 3]}`,
        minutes: 8 + ((i * 5 + j * 11) % 16),
        body: lessonBody(course.title, topic, j)
      });
    }
    chapters.push({ chapterNo: i + 1, chapterTitle: `第${i + 1}章 ${topic}`, lessons });
  }
  return chapters;
}

/** 生成写入 lessons 表的扁平行 */
export function flattenLessons(key, course) {
  const rows = [];
  for (const chapter of buildLessons(key, course)) {
    for (const lesson of chapter.lessons) {
      rows.push({
        courseKey: key,
        chapterNo: chapter.chapterNo,
        chapterTitle: chapter.chapterTitle,
        lessonNo: lesson.lessonNo,
        title: lesson.title,
        minutes: lesson.minutes,
        body: JSON.stringify(lesson.body)
      });
    }
  }
  return rows;
}
