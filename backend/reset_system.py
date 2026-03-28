import os


def reset_turtle_vision_data():
    # 1. Define Paths (Relative to this script)
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, 'data')

    turtles_dir = os.path.join(base_dir, 'turtles')

    # Deprecated VLAD/FAISS fallback files
    model_files = [
        os.path.join(turtles_dir, 'vlad_vocab.pkl'),
        os.path.join(turtles_dir, 'turtles.index'),
        os.path.join(turtles_dir, 'global_vlad_array.npy'),
        os.path.join(turtles_dir, 'metadata.pkl')
    ]

    print("⚠️  STARTING SYSTEM RESET ⚠️")
    print(f"Scanning: {data_dir}")
    print(f"Scanning Models: {turtles_dir}")

    # 2. Delete legacy .npz files (deprecated fallback data)
    npz_deleted_count = 0
    if os.path.exists(data_dir):
        for root, dirs, files in os.walk(data_dir):
            for file in files:
                if file.endswith(".npz"):
                    file_path = os.path.join(root, file)
                    try:
                        os.remove(file_path)
                        npz_deleted_count += 1
                        # Optional: Print every 100 deletions to show progress
                        if npz_deleted_count % 100 == 0:
                            print(f"   Deleted {npz_deleted_count} .npz files...")
                    except Exception as e:
                        print(f"   Error deleting {file_path}: {e}")
    else:
        print(f"❌ Data directory not found: {data_dir}")

    print(f"✅ Removed {npz_deleted_count} old .npz files.")

    # 3. Delete deprecated index/vocabulary files
    print("Removing deprecated VLAD/FAISS files...")
    for model_path in model_files:
        if os.path.exists(model_path):
            try:
                os.remove(model_path)
                print(f"   🗑️  Deleted: {os.path.basename(model_path)}")
            except Exception as e:
                print(f"   ❌ Error deleting {os.path.basename(model_path)}: {e}")
        else:
            print(f"   (File not found: {os.path.basename(model_path)})")

    print("\n🎉 SYSTEM RESET COMPLETE.")


if __name__ == "__main__":
    confirmation = input("Type 'yes' to delete all training data and start fresh: ")
    if confirmation.lower() == 'yes':
        reset_turtle_vision_data()
    else:
        print("Operation cancelled.")