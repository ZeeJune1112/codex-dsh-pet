export const zh = {
  'desktopPet.title': 'DSH 桌宠',
  'desktopPet.description': '管理多只 Codex 桌宠，也可直接从 Petdex 导入。',
  loading: '正在读取桌宠…', retry: '重试', currentPet: '当前桌宠', showing: '桌面显示中', hidden: '已隐藏',
  showPet: '显示这只', hidePet: '隐藏这只', petLibrary: '宠物库', dragHint: '拖动卡片可排序', size: '桌宠大小',
  hideWhenIdle: '无任务时自动隐藏', hideWhenIdleHint: '有新任务时自动重新显示。', importTitle: '导入新桌宠',
  importHint: '输入 petdex.dev 桌宠页面末尾的名称。导入后立即选中并显示。', petdexSlug: 'Petdex 名称',
  import: '导入', importing: '导入中…', browsePetdex: '浏览 Petdex 桌宠库',
  codexZipHint: '也可以导入 Codex 桌宠 ZIP，支持口袋桌宠导出的配置。', chooseZip: '选择 ZIP',
} satisfies Record<string, string>
export type DesktopPetKey = keyof typeof zh
export const en = {
  'desktopPet.title': 'DSH Pet',
  'desktopPet.description': 'Manage multiple Codex pets and import directly from Petdex.',
  loading: 'Loading pets…', retry: 'Retry', currentPet: 'Current pet', showing: 'Visible on desktop', hidden: 'Hidden',
  showPet: 'Show this pet', hidePet: 'Hide this pet', petLibrary: 'Pet library', dragHint: 'Drag cards to reorder', size: 'Pet size',
  hideWhenIdle: 'Hide when idle', hideWhenIdleHint: 'Show again when a new task starts.', importTitle: 'Import a pet',
  importHint: 'Enter the name at the end of a petdex.dev pet page. Imported pets become selected and visible.', petdexSlug: 'Petdex name',
  import: 'Import', importing: 'Importing…', browsePetdex: 'Browse Petdex pets',
  codexZipHint: 'You can also import a Codex pet ZIP, including Pocket Pet exported settings.', chooseZip: 'Choose ZIP',
} satisfies Record<DesktopPetKey, string>
