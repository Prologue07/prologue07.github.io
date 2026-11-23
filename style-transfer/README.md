# 借来的笔触

韦君豪的 AdaIN 图像风格迁移实验。网页收录三张内容照片与十张参考画的迁移结果，也支持在浏览器中对自选图片运行第 10 轮解码器。

[打开创作台](https://prologue07.github.io/style-transfer/)

基于 Huang 与 Belongie 的 [AdaIN](https://arxiv.org/abs/1703.06868)。编码器使用 torchvision 的 ImageNet VGG-19，截至 relu4_1。解码器文件为本项目的原始 PyTorch checkpoint。
