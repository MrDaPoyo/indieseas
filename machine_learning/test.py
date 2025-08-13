import torch
import torch.nn as nn
from torchvision import transforms, models
from PIL import Image
import argparse
import json

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

def build_val_transform(img_size: int):
    return transforms.Compose([
        transforms.Resize(int(img_size * 1.15)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])

def build_model(num_classes: int = 2):
    try:
        weights = models.ResNet18_Weights.IMAGENET1K_V1
    except AttributeError:
        weights = None
    model = models.resnet18(weights=weights)
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, num_classes)
    return model

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=str, required=True, help="Path to trained .pt file")
    parser.add_argument("--image-path", type=str, required=False, default="test.jpg", help="Path to input image")
    parser.add_argument("--img-size", type=int, default=224, help="Image size (match training)")
    parser.add_argument("--gpu", action="store_true", help="Use GPU if available")
    args = parser.parse_args()

    checkpoint = torch.load(args.model_path, map_location="cpu")
    class_names = checkpoint.get("class_names", ["indie", "corpo"])

    device = torch.device("cuda" if args.gpu and torch.cuda.is_available() else "cpu")

    model = build_model(num_classes=len(class_names))
    model.load_state_dict(checkpoint["model_state"])
    model.to(device)
    model.eval()

    tfm = build_val_transform(args.img_size)
    img = Image.open(args.image_path).convert("RGB")
    img_t = tfm(img).unsqueeze(0).to(device)

    with torch.no_grad():
        outputs = model(img_t)
        probs = torch.softmax(outputs, dim=1).cpu().numpy()[0]
        pred_idx = int(probs.argmax())
        pred_class = class_names[pred_idx]

    print(f"Image: {args.image_path}")
    print(f"Predicted: {pred_class} (confidence: {probs[pred_idx]:.4f})")
    print("Class probabilities:")
    for name, p in zip(class_names, probs):
        print(f"  {name}: {p:.4f}")

if __name__ == "__main__":
    main()
