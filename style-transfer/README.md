# 借来的笔触

韦君豪的 AdaIN 风格迁移实验。展厅收录三张照片与十张参考画的三十组搭配，可以用分界线对照两套模型。画室支持上传图片、调节风格强度和导出 PNG。图片和模型推理都留在访客的浏览器中。

[打开画室](https://prologue07.github.io/style-transfer/#studio)

- **我们的模型**使用 torchvision VGG-19 编码器和本项目训练的第 10 轮解码器。
- **论文作者模型**使用 Huang 与 Belongie 的 AdaIN 权重，经 Naoto Inoue 转为 PyTorch 格式。网页保存推理所需的 float32 参数，包括原编码器的颜色预处理层，编码到 relu4_1。

[论文](https://arxiv.org/abs/1703.06868) · [作者实现](https://github.com/xunhuang1995/AdaIN-style) · [PyTorch 权重与转换说明](https://github.com/naoto0804/pytorch-AdaIN/issues/21#issuecomment-508886660) · [转换版下载](https://github.com/naoto0804/pytorch-AdaIN/releases/tag/v0.0.0)
