import os
import argparse
import random
from pathlib import Path
import io
import base64
from PIL import Image

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import Subset, DataLoader
from torchvision import datasets, transforms, models

def set_seed(seed: int = 42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)

def get_device(allow_cpu: bool = False, gpu_index: int = 0) -> torch.device:
    if torch.cuda.is_available():
        torch.cuda.set_device(gpu_index)
        torch.backends.cudnn.benchmark = True
        torch.backends.cuda.matmul.allow_tf32 = True
        torch.backends.cudnn.allow_tf32 = True
        return torch.device(f"cuda:{gpu_index}")
    if allow_cpu:
        return torch.device("cpu")
    raise SystemExit("CUDA is required but not available. Re-run with --allow-cpu to override.")

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]

def build_train_transform(img_size: int):
    return transforms.Compose([
        transforms.RandomResizedCrop(img_size, scale=(0.7, 1.0)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.15),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])

def build_val_transform(img_size: int):
    return transforms.Compose([
        transforms.Resize(int(img_size * 1.15)),
        transforms.CenterCrop(img_size),
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])

def build_val_transform_variable_size():
    return transforms.Compose([
        transforms.ToTensor(),
        transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD),
    ])

def make_multiscale_collate(size_choices):
    jitter = transforms.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.15)
    hflip = transforms.RandomHorizontalFlip()
    to_tensor = transforms.ToTensor()
    normalize = transforms.Normalize(IMAGENET_MEAN, IMAGENET_STD)

    def collate(batch):
        size = random.choice(size_choices)
        crop = transforms.RandomResizedCrop(size, scale=(0.7, 1.0))

        images, targets = zip(*batch)
        processed = []
        for img in images:
            if isinstance(img, torch.Tensor):
                img = transforms.ToPILImage()(img)
            img = jitter(img)
            img = hflip(img)
            img = crop(img)
            t = to_tensor(img)
            t = normalize(t)
            processed.append(t)
        return torch.stack(processed, dim=0), torch.tensor(targets, dtype=torch.long)

    return collate

def _smart_image_loader(path: str):
    try:
        with Image.open(path) as img:
            return img.convert("RGB")
    except Exception as e1:
        try:
            with open(path, "rb") as f:
                raw = f.read()
            stripped = b"".join(raw.split())
            decoded = base64.b64decode(stripped, validate=False)
            with Image.open(io.BytesIO(decoded)) as img:
                return img.convert("RGB")
        except Exception:
            raise e1

# only accept .jpg files
def _is_valid_jpg_not_node_modules(p: str) -> bool:
    try:
        parts = Path(p).parts
    except Exception:
        parts = ()
    if "node_modules" in parts:
        return False
    return p.lower().endswith(".jpg")

class _FilteredImageFolder(datasets.ImageFolder):
    def find_classes(self, directory: str):
        classes = [d.name for d in os.scandir(directory) if d.is_dir()]
        allowed = ["indie", "corpo"]
        classes = [c for c in classes if c in allowed]
        if not classes:
            raise FileNotFoundError(f"No valid class folders found in {directory}. Expected {allowed}.")
        classes.sort()
        class_to_idx = {cls_name: i for i, cls_name in enumerate(classes)}
        return classes, class_to_idx

def build_dataloaders(
    data_dir: str,
    img_size: int = 224,
    batch_size: int = 32,
    val_split: float = 0.2,
    num_workers: int = 4,
    seed: int = 42,
    use_cuda: bool = True,
    per_batch_multiscale: bool = False,
    multiscale_size_choices: list[int] | None = None,
    variable_val: bool = False,
    force_no_pin_memory: bool = False,
):
    if per_batch_multiscale:
        train_tfms = None
    else:
        train_tfms = build_train_transform(img_size)

    val_tfms = build_val_transform_variable_size() if variable_val else build_val_transform(img_size)

    ref_ds = _FilteredImageFolder(
        root=data_dir,
        loader=_smart_image_loader,
        is_valid_file=_is_valid_jpg_not_node_modules,
    )
    class_names = ref_ds.classes
    expected = {"indie", "corpo"}
    if set(class_names) != expected:
        print(f"Warning: expected classes {sorted(expected)}, found {class_names}. Proceeding anyway.")

    indices = list(range(len(ref_ds)))
    random.Random(seed).shuffle(indices)
    n_val = int(len(indices) * val_split)
    val_idx = indices[:n_val]
    train_idx = indices[n_val:]

    train_ds = _FilteredImageFolder(
        root=data_dir,
        transform=train_tfms,
        loader=_smart_image_loader,
        is_valid_file=_is_valid_jpg_not_node_modules,
    )
    val_ds = _FilteredImageFolder(
        root=data_dir,
        transform=val_tfms,
        loader=_smart_image_loader,
        is_valid_file=_is_valid_jpg_not_node_modules,
    )

    train_subset = Subset(train_ds, train_idx)
    val_subset = Subset(val_ds, val_idx)

    pin_memory = bool(use_cuda and not force_no_pin_memory)

    train_collate = make_multiscale_collate(multiscale_size_choices) if per_batch_multiscale else None
    effective_val_bs = 1 if variable_val else batch_size

    train_loader = DataLoader(
        train_subset,
        batch_size=batch_size,
        shuffle=True,
        num_workers=num_workers,
        pin_memory=pin_memory,
        drop_last=False,
        persistent_workers=num_workers > 0,
        collate_fn=train_collate,
    )
    val_loader = DataLoader(
        val_subset,
        batch_size=effective_val_bs,
        shuffle=False,
        num_workers=num_workers,
        pin_memory=pin_memory,
        drop_last=False,
        persistent_workers=num_workers > 0,
    )
    return train_loader, val_loader, class_names

def build_model(num_classes: int = 2, freeze_base: bool = False) -> nn.Module:
    try:
        weights = models.ResNet18_Weights.IMAGENET1K_V1
    except AttributeError:
        weights = None
    model = models.resnet18(weights=weights)
    if freeze_base:
        for p in model.parameters():
            p.requires_grad = False
    in_features = model.fc.in_features
    model.fc = nn.Linear(in_features, num_classes)
    return model

def train_one_epoch(model, loader, device, criterion, optimizer, scaler=None, amp=False):
    model.train()
    running_loss = 0.0
    correct = 0
    total = 0
    for images, targets in loader:
        if device.type == "cuda":
            images = images.to(device, non_blocking=True, memory_format=torch.channels_last)
        else:
            images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)

        optimizer.zero_grad(set_to_none=True)
        if amp and scaler is not None:
            with torch.amp.autocast(device_type=device.type, dtype=torch.float16 if device.type == "cuda" else None):
                outputs = model(images)
                loss = criterion(outputs, targets)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
        else:
            outputs = model(images)
            loss = criterion(outputs, targets)
            loss.backward()
            optimizer.step()

        running_loss += loss.item() * images.size(0)
        preds = outputs.argmax(dim=1)
        correct += (preds == targets).sum().item()
        total += targets.size(0)
    return running_loss / max(total, 1), correct / max(total, 1)

@torch.no_grad()
def evaluate(model, loader, device, criterion, amp: bool = False):
    model.eval()
    running_loss = 0.0
    correct = 0
    total = 0
    for images, targets in loader:
        if device.type == "cuda":
            images = images.to(device, non_blocking=True, memory_format=torch.channels_last)
        else:
            images = images.to(device, non_blocking=True)
        targets = targets.to(device, non_blocking=True)
        if amp:
            with torch.amp.autocast(device_type=device.type, dtype=torch.float16 if device.type == "cuda" else None):
                outputs = model(images)
                loss = criterion(outputs, targets)
        else:
            outputs = model(images)
            loss = criterion(outputs, targets)
        running_loss += loss.item() * images.size(0)
        preds = outputs.argmax(dim=1)
        correct += (preds == targets).sum().item()
        total += targets.size(0)
    return running_loss / max(total, 1), correct / max(total, 1)

def main():
    parser = argparse.ArgumentParser(description="Indie vs Copro website image classifier (PyTorch + CUDA)")
    parser.add_argument("--data-dir", type=str, required=True, help="Root folder with subfolders 'indie' and 'corpo'")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--img-size", type=int, default=224)
    parser.add_argument("--img-size-min", type=int, default=224, help="Enable multi-scale training with this min size (e.g., 1080 for 1080p images)")
    parser.add_argument("--img-size-max", type=int, default=224, help="Enable multi-scale training with this max size")
    parser.add_argument("--multiscale-step", type=int, default=32, help="Step between sizes when sampling in range")
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--val-split", type=float, default=0.2)
    parser.add_argument("--workers", type=int, default=min(5, os.cpu_count() or 1))
    parser.add_argument("--freeze-base", action="store_true", help="Freeze backbone and train final layer only")
    parser.add_argument("--out", type=str, default=str(Path.cwd() / "indieseas_website_classifier_resnet18.pt"))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-amp", action="store_true", help="Disable mixed precision")
    parser.add_argument("--allow-cpu", action="store_true", help="Allow CPU if CUDA is unavailable")
    parser.add_argument("--gpu-index", type=int, default=0, help="CUDA device index to use")
    parser.add_argument("--per-batch-multiscale", action="store_true", help="Sample a random train size per batch (requires a size range)")
    parser.add_argument("--variable-val", action="store_true", help="Validate at original image sizes without resizing (uses batch_size=1)")
    parser.add_argument("--train-max-size", type=int, default=None, help="Upper cap for train image sizes in multiscale to prevent OOM")
    parser.add_argument("--no-pin-memory", action="store_true", help="Disable DataLoader pin_memory (mitigates pinned-memory OOM)")
    args = parser.parse_args()

    set_seed(args.seed)
    device = get_device(allow_cpu=args.allow_cpu, gpu_index=args.gpu_index)
    use_cuda = device.type == "cuda"
    amp = use_cuda and (not args.no_amp)
    if use_cuda:
        cur_idx = device.index if device.index is not None else torch.cuda.current_device()
        print(f"Using CUDA device {cur_idx}: {torch.cuda.get_device_name(cur_idx)}")

    have_range = args.img_size_min != args.img_size_max
    size_choices = None
    if have_range:
        lo = max(32, min(args.img_size_min, args.img_size_max))
        hi = max(32, max(args.img_size_min, args.img_size_max))
        step = max(1, args.multiscale_step)
        size_choices = list(range(lo, hi + 1, step))
        safe_cap = args.train_max_size if args.train_max_size is not None else max(64, min(1024, args.img_size * 2))
        if any(s > safe_cap for s in size_choices):
            capped = [s for s in size_choices if s <= safe_cap]
            if not capped:
                capped = [min(size_choices)]
            print(f"Capping train sizes to <= {safe_cap} to prevent OOM.")
            size_choices = capped
        mode = "per-batch" if args.per_batch_multiscale else "per-epoch"
        print(f"Multi-scale requested ({mode}). Range: {size_choices} (val size: {args.img_size})")

    max_train_size = max(size_choices) if size_choices else args.img_size
    force_no_pin_memory = args.no_pin_memory or (args.per_batch_multiscale and max_train_size >= 1024)
    if force_no_pin_memory:
        print("pin_memory disabled to reduce risk of pinned-memory OOM.")

    train_loader, val_loader, class_names = build_dataloaders(
        args.data_dir,
        img_size=args.img_size,
        batch_size=args.batch_size,
        val_split=args.val_split,
        num_workers=args.workers,
        seed=args.seed,
        use_cuda=use_cuda,
        per_batch_multiscale=bool(args.per_batch_multiscale and have_range),
        multiscale_size_choices=size_choices,
        variable_val=args.variable_val,
        force_no_pin_memory=force_no_pin_memory,
    )
    print(f"Classes: {class_names} | Train batches: {len(train_loader)} | Val batches: {len(val_loader)}")
    print(f"Device: {device} | AMP: {amp}")

    model = build_model(num_classes=2, freeze_base=args.freeze_base).to(device)
    if use_cuda:
        model = model.to(memory_format=torch.channels_last)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(filter(lambda p: p.requires_grad, model.parameters()), lr=args.lr, weight_decay=args.weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)
    scaler = torch.amp.GradScaler(enabled=amp)

    best_val_acc = 0.0
    best_path = Path("output", args.out)
    best_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, args.epochs + 1):
        if have_range and not args.per_batch_multiscale:
            epoch_img_size = random.choice(size_choices)
            print(f"[Epoch {epoch:03d}] Using train img_size={epoch_img_size}")
            train_loader.dataset.dataset.transform = build_train_transform(epoch_img_size)

        train_loss, train_acc = train_one_epoch(model, train_loader, device, criterion, optimizer, scaler, amp)
        val_loss, val_acc = evaluate(model, val_loader, device, criterion, amp=amp)
        scheduler.step()

        print(f"Epoch {epoch:03d}/{args.epochs} | "
              f"Train Loss: {train_loss:.4f} Acc: {train_acc:.4f} | "
              f"Val Loss: {val_loss:.4f} Acc: {val_acc:.4f} | "
              f"LR: {scheduler.get_last_lr()[0]:.6f}")

        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(
                {
                    "model_state": model.state_dict(),
                    "class_names": class_names,
                    "config": vars(args),
                },
                best_path,
            )
            print(f"Saved new best model to {best_path} (val_acc={best_val_acc:.4f})")

    print(f"Training complete. Best val acc: {best_val_acc:.4f}. Model: {best_path}")

if __name__ == "__main__":
    main()
