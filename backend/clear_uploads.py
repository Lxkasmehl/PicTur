"""
Clear all uploaded data from the server
- Review Queue items
- Community Uploads
- Temporary uploaded files
"""

import os
import shutil
import tempfile
from pathlib import Path


def clear_all_uploads():
    """Clear all uploaded data (Review Queue, Community Uploads, temp files)"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, 'data')
    
    print("🧹 CLEARING ALL UPLOADED DATA 🧹")
    print(f"Data directory: {data_dir}\n")
    
    deleted_count = 0
    
    # 1. Clear Review Queue
    review_queue_dir = os.path.join(data_dir, 'Review_Queue')
    if os.path.exists(review_queue_dir):
        print("📋 Clearing Review Queue...")
        for item in os.listdir(review_queue_dir):
            item_path = os.path.join(review_queue_dir, item)
            try:
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path)
                    deleted_count += 1
                    print(f"   🗑️  Deleted: {item}")
                else:
                    os.remove(item_path)
                    deleted_count += 1
            except Exception as e:
                print(f"   ❌ Error deleting {item}: {e}")
        print(f"✅ Review Queue cleared ({deleted_count} items)\n")
    else:
        print("📋 Review Queue directory not found (already empty)\n")
    
    # 2. Clear Community Uploads
    community_dir = os.path.join(data_dir, 'Community_Uploads')
    if os.path.exists(community_dir):
        print("👥 Clearing Community Uploads...")
        community_count = 0
        for finder_dir in os.listdir(community_dir):
            finder_path = os.path.join(community_dir, finder_dir)
            try:
                if os.path.isdir(finder_path):
                    # Count files in this directory
                    file_count = len([f for f in os.listdir(finder_path) 
                                     if os.path.isfile(os.path.join(finder_path, f))])
                    shutil.rmtree(finder_path)
                    community_count += file_count
                    print(f"   🗑️  Deleted {finder_dir} ({file_count} files)")
            except Exception as e:
                print(f"   ❌ Error deleting {finder_dir}: {e}")
        print(f"✅ Community Uploads cleared ({community_count} files)\n")
    else:
        print("👥 Community Uploads directory not found (already empty)\n")
    
    # 3. Clear temporary uploaded files (from temp directory)
    temp_dir = tempfile.gettempdir()
    print(f"📁 Clearing temporary files from: {temp_dir}")
    temp_count = 0
    
    # Look for image files that might be from our uploads
    # (This is a bit tricky since we can't be 100% sure which files are ours)
    # We'll look for common image extensions
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp'}
    
    try:
        for file in os.listdir(temp_dir):
            file_path = os.path.join(temp_dir, file)
            # Only delete if it's a file (not a directory) and has an image extension
            if os.path.isfile(file_path):
                file_ext = Path(file).suffix.lower()
                if file_ext in image_extensions:
                    try:
                        os.remove(file_path)
                        temp_count += 1
                        if temp_count <= 10:  # Only print first 10
                            print(f"   🗑️  Deleted: {file}")
                    except Exception as e:
                        print(f"   ⚠️  Could not delete {file}: {e}")
        
        if temp_count > 10:
            print(f"   ... and {temp_count - 10} more files")
        print(f"✅ Temporary files cleared ({temp_count} files)\n")
    except Exception as e:
        print(f"⚠️  Error accessing temp directory: {e}\n")
    
    print("🎉 ALL UPLOADED DATA CLEARED!")
    print(f"   Total items deleted: {deleted_count + community_count + temp_count}")
    print("\n💡 Note: This does NOT delete:")
    print("   - Official turtle data (State/Location folders)")
    print("   - Deprecated VLAD/FAISS fallback indexes and vocabulary")
    print("   - Existing reference tensors/models")


def clear_review_queue_only():
    """Clear only the Review Queue"""
    base_dir = os.path.dirname(os.path.abspath(__file__))
    review_queue_dir = os.path.join(base_dir, 'data', 'Review_Queue')
    
    print("📋 Clearing Review Queue only...")
    
    if not os.path.exists(review_queue_dir):
        print("Review Queue is already empty.")
        return
    
    deleted_count = 0
    for item in os.listdir(review_queue_dir):
        item_path = os.path.join(review_queue_dir, item)
        try:
            if os.path.isdir(item_path):
                shutil.rmtree(item_path)
                deleted_count += 1
                print(f"   🗑️  Deleted: {item}")
        except Exception as e:
            print(f"   ❌ Error deleting {item}: {e}")
    
    print(f"✅ Review Queue cleared ({deleted_count} items)")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == '--review-only':
        # Only clear review queue
        clear_review_queue_only()
    else:
        # Clear everything
        print("⚠️  WARNING: This will delete ALL uploaded data!")
        print("   - Review Queue items")
        print("   - Community Uploads")
        print("   - Temporary uploaded files")
        print("\n   This does NOT delete official turtle data or trained models.\n")
        
        confirmation = input("Type 'yes' to continue: ")
        if confirmation.lower() == 'yes':
            clear_all_uploads()
        else:
            print("Operation cancelled.")

