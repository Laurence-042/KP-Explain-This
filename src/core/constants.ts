/** 骰子与分页的默认参数（部分可在开局时配置） */
export const DEFAULT_DICE_COUNT = 3
export const DICE_SIDES = 10

/** TXT 虚拟分页：每页词数 */
export const DEFAULT_PAGE_WORDS = 300
/** TXT 导入支持的最大文件大小（字符数，约 4MB 文本） */
export const MAX_BOOK_CHARS = 4_000_000

/** "有足够文字的页"判定：页内词数下限 */
export const MIN_VALID_PAGE_WORDS = 30

/** World State 列表字段（facts/events/inventory）去重后的最大保留条数 */
export const MAX_LIST_ITEMS = 50

/**
 * 有效关键词的过滤规则：
 * - 含 CJK 的词：长度 >= 2
 * - 拉丁字母词：长度 >= 3
 * - 纯数字、符号一律无效
 * - 命中停用词表一律无效
 */
export const MIN_CJK_WORD_LEN = 2
export const MIN_LATIN_WORD_LEN = 3

/** 常见虚词/功能词，不配做关键词。小表即可：抽取时允许跳过取最近的下一个有效词。 */
export const STOPWORDS = new Set<string>([
  // 英文
  'the', 'and', 'was', 'were', 'are', 'is', 'has', 'had', 'have', 'that', 'this',
  'with', 'from', 'they', 'them', 'their', 'there', 'then', 'than', 'when', 'what',
  'where', 'which', 'while', 'would', 'could', 'should', 'will', 'shall', 'been',
  'being', 'into', 'onto', 'upon', 'over', 'under', 'about', 'after', 'before',
  'again', 'just', 'like', 'made', 'does', 'done', 'very', 'much', 'more', 'most',
  'some', 'such', 'only', 'also', 'your', 'you', 'she', 'her', 'his', 'him', 'its',
  'our', 'out', 'off', 'how', 'who', 'why', 'not', 'but', 'for', 'all', 'can',
  'did', 'get', 'got', 'one', 'two', 'say', 'see', 'way', 'who', 'whom',
  // 中文
  '我们', '你们', '他们', '她们', '它们', '自己', '什么', '怎么', '为什么', '这样',
  '那样', '这里', '那里', '时候', '地方', '东西', '事情', '知道', '觉得', '认为',
  '现在', '已经', '还是', '但是', '如果', '因为', '所以', '或者', '以及', '不是',
  '没有', '这个', '那个', '可以', '应该', '一定', '非常', '就是', '的话', '一下',
  '一些', '许多', '很多', '大家', '所有', '开始', '起来', '过来', '出来', '回去',
  '一个', '一起', '一样', '起来', '进去', '上面', '下面', '前面', '后面', '里面',
])
