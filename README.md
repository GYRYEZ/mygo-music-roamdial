# RoamDial 电台 for MyGo Music

把 [RoamDial](https://roamdial.com) 的世界网络电台接进 MyGo Music。浏览、搜索并直接播放，不需要登录 RoamDial。

## 功能

- 约 3.2 万个可直接播放的电台
- 热门、分类、国家地区、随便听听
- 搜索台名、标签、城市、国家和分类
- 电台优先显示站点公开台标；ICO、SVG、GIF 会转成 PNG，站点没有可用台标时显示插件自带封面
- 11 个分类封面，219 个国家/地区方形旗帜封面
- 音频由 MyGo 原生播放

## 安装

需要 MyGo Music 0.1.8 或更高版本。

在 MyGo Music 中打开「设置 → 插件 → 安装插件 → 从 GitHub…」，填入：

```text
GYRYEZ/mygo-music-roamdial
```

也可以打开：

```text
mygo-music://install-plugin?repo=GYRYEZ/mygo-music-roamdial
```

手动安装：把整个文件夹放进
`~/Library/Application Support/MyGo Music/plugins/roamdial`，然后重启 MyGo Music。

## 数据与封面

- 电台数据来自 RoamDial 的公开接口 `/api/globe?part=core` 与 `/api/globe?part=rest`
- 台标来自 RoamDial 收录的各电台站点公开图标；非 MyGo 可解码格式通过 `images.weserv.nl` 转换
- 国家/地区旗帜来自 [flagcdn.com](https://flagcdn.com)
- 其他分类与备用封面由本项目生成

电台名称、台标与内容版权归各电台所有。
