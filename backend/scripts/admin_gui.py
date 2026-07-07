import sys
import os
import time
import threading
import tkinter as tk
from tkinter import filedialog, messagebox, ttk
from PIL import Image, ImageTk

# --- PATH HACK ---
current_dir = os.path.dirname(os.path.abspath(__file__))
if current_dir not in sys.path:
    sys.path.append(current_dir)

from turtle_manager import TurtleManager

# Initialize Manager
manager = TurtleManager()


class IdentifyWindow:
    def __init__(self, master, current_device):
        self.top = tk.Toplevel(master)
        self.top.title("Identify & Add Observation")
        self.top.geometry("1600x1000")

        self.query_path = None
        self.current_device = current_device

        # --- LEFT PANEL: CONTROLS & LOG ---
        frame_left = tk.Frame(self.top, width=450, bg="#ecf0f1")
        frame_left.pack(side="left", fill="y", padx=10, pady=10)
        frame_left.pack_propagate(False)  # Force width

        # 1. Image Preview
        tk.Label(frame_left, text="Query Image", font=("Arial", 12, "bold"), bg="#ecf0f1").pack(pady=(10, 5))
        self.lbl_query_img = tk.Label(frame_left, bg="#bdc3c7", text="No Image Selected")
        self.lbl_query_img.pack(pady=5)

        # 2. Location Filter
        tk.Label(frame_left, text="Search Location:", bg="#ecf0f1", font=("Arial", 10)).pack(pady=(15, 2), anchor="w")

        locs = manager.get_all_locations()
        if "All Locations" not in locs:
            locs.insert(0, "All Locations")

        self.combo_location = ttk.Combobox(frame_left, values=locs, state="readonly")
        self.combo_location.current(0)
        self.combo_location.pack(fill="x", pady=5)

        # 3. Single Image Buttons
        tk.Label(frame_left, text="Single Operations:", bg="#ecf0f1", font=("Arial", 10, "bold")).pack(pady=(15, 2),
                                                                                                       anchor="w")
        btn_browse = tk.Button(frame_left, text="📂 Select Single Image", command=self.browse_image, bg="#3498db",
                               fg="white", font=("Arial", 11))
        btn_browse.pack(fill="x", pady=5)

        self.btn_search = tk.Button(frame_left, text="🔍 Search Single", command=self.run_search, bg="#e67e22",
                                    fg="white", font=("Arial", 11, "bold"))
        self.btn_search.pack(fill="x", pady=5)

        # 4. Bulk Button
        tk.Label(frame_left, text="Bulk Testing (No Save):", bg="#ecf0f1", font=("Arial", 10, "bold")).pack(
            pady=(15, 2), anchor="w")
        self.btn_bulk = tk.Button(frame_left, text="🧪 Bulk Test Folder (Log Only)", command=self.run_bulk_test,
                                  bg="#8e44ad", fg="white", font=("Arial", 11, "bold"))
        self.btn_bulk.pack(fill="x", pady=5)

        # 5. Session Log
        tk.Label(frame_left, text="Session History:", bg="#ecf0f1", font=("Arial", 10, "bold")).pack(pady=(20, 5),
                                                                                                     anchor="w")

        self.log_list = tk.Listbox(frame_left, height=20, font=("Courier", 9))
        self.log_list.pack(fill="both", expand=True, pady=5)

        log_scroll = tk.Scrollbar(self.log_list)
        log_scroll.pack(side="right", fill="y")
        self.log_list.config(yscrollcommand=log_scroll.set)
        log_scroll.config(command=self.log_list.yview)

        # --- RIGHT PANEL: RESULTS ---
        self.frame_results = tk.Frame(self.top)
        self.frame_results.pack(side="right", fill="both", expand=True, padx=10, pady=10)

        self.lbl_results_header = tk.Label(self.frame_results, text="Top Matches (Sorted by Match Count)",
                                           font=("Arial", 12, "bold"))
        self.lbl_results_header.pack(pady=10)

        # Scrollable area
        canvas = tk.Canvas(self.frame_results)
        scrollbar = tk.Scrollbar(self.frame_results, orient="vertical", command=canvas.yview)
        self.scrollable_frame = tk.Frame(canvas)

        self.scrollable_frame.bind("<Configure>", lambda e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

    def log_message(self, status_icon, filename, note="", time_taken=None):
        """Adds a line to the Session History listbox with timing"""
        t_str = f"[{time_taken:.2f}s]" if time_taken is not None else ""
        msg = f"{status_icon} {filename} {t_str} {note}"
        self.log_list.insert(0, msg)
        self.log_list.see(0)
        self.top.update()

    def browse_image(self):
        path = filedialog.askopenfilename(filetypes=[("Images", "*.jpg *.png *.jpeg")], parent=self.top)
        if path:
            self.query_path = path
            self.show_image(path, self.lbl_query_img, size=(300, 300))
            for widget in self.scrollable_frame.winfo_children():
                widget.destroy()

    def show_image(self, path, label_widget, size=(300, 300)):
        try:
            img = Image.open(path)
            img.thumbnail(size)
            img_tk = ImageTk.PhotoImage(img)
            label_widget.config(image=img_tk, text="")
            label_widget.image = img_tk
        except Exception as e:
            print(f"Error loading image: {e}")

    # --- THREADED SINGLE SEARCH ---
    def run_search(self):
        if not self.query_path: return
        self.btn_search.config(state="disabled")

        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()

        # Dispatch to background thread
        threading.Thread(target=self._thread_search, args=(self.query_path, self.combo_location.get()),
                         daemon=True).start()

    def _thread_search(self, query_path, loc_filter):
        fname = os.path.basename(query_path)
        try:
            results, time_taken = manager.search_for_matches(query_path, location_filter=loc_filter)
        except Exception as e:
            self.top.after(0, self._handle_search_error, fname, str(e))
            return

        self.top.after(0, self._process_single_results, fname, results, time_taken)

    def _handle_search_error(self, fname, error_msg):
        self.btn_search.config(state="normal")
        self.log_message("💥", fname, f"Error: {error_msg}")
        tk.Label(self.scrollable_frame, text=f"Search failed: {error_msg}", font=("Arial", 12), fg="red").pack(pady=20)

    def _process_single_results(self, fname, results, time_taken):
        self.btn_search.config(state="normal")
        if not results:
            tk.Label(self.scrollable_frame, text="No matches found.", font=("Arial", 12)).pack(pady=20)
            self.log_message("❌", fname, "(No Matches)", time_taken)
            return

        top_match_id = results[0]['site_id']
        top_score = results[0]['score']
        self.log_message("✅", fname, f"-> {top_match_id} ({top_score})", time_taken)

        for i, res in enumerate(results):
            self.create_match_card(res, i + 1)

    # --- THREADED BULK TEST ---
    def run_bulk_test(self):
        folder_path = filedialog.askdirectory(title="Select Folder to Test", parent=self.top)
        self.top.lift()
        self.top.focus_force()

        if not folder_path: return

        # 🚀 FIX: Lock the UI buttons to prevent concurrent actions
        self.btn_bulk.config(state="disabled")
        self.btn_search.config(state="disabled")

        # 🚀 FIX: Destroy any lingering match cards so they can't be clicked
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()

        # Add a friendly indicator that the right panel is intentionally blank
        tk.Label(self.scrollable_frame, text="🧪 Bulk Test Running...\nSee the Left Panel for live logs.",
                 font=("Arial", 12, "bold"), fg="#7f8c8d").pack(pady=40)

        threading.Thread(target=self._thread_bulk, args=(folder_path, self.combo_location.get()), daemon=True).start()

    def _thread_bulk(self, folder_path, loc_filter):
        BULK_THRESHOLD = 400
        try:
            files = [f for f in os.listdir(folder_path) if f.lower().endswith(('.jpg', '.jpeg', '.png'))]
        except Exception as e:
            self.top.after(0, self._handle_bulk_error, str(e))
            return

        total = len(files)
        count_good = 0
        total_time = 0.0

        self.top.after(0, self.log_message, "🧪", "TEST START", f"Testing {total} images...")

        for filename in files:
            file_path = os.path.join(folder_path, filename)

            self.top.after(0, self.show_image, file_path, self.lbl_query_img, (300, 300))

            try:
                results, time_taken = manager.search_for_matches(file_path, location_filter=loc_filter)
            except Exception as e:
                self.top.after(0, self.log_message, "💥", filename, f"Error: {e}")
                continue

            total_time += time_taken

            if results:
                top_score = results[0]['score']
                top_id = results[0]['site_id']

                if top_score >= BULK_THRESHOLD:
                    self.top.after(0, self.log_message, "✅", filename, f"-> {top_id} ({top_score})", time_taken)
                    count_good += 1
                else:
                    self.top.after(0, self.log_message, "⚠️", filename, f"Weak Match ({top_score})", time_taken)
            else:
                self.top.after(0, self.log_message, "❌", filename, "No Matches", time_taken)

        try:
            manager.save_benchmark(self.current_device, total_time)
        except Exception:
            pass

        self.top.after(0, self._bulk_test_complete, count_good, total, total_time)

    def _handle_bulk_error(self, error_msg):
        self.btn_bulk.config(state="normal")
        self.btn_search.config(state="normal")
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()
        self.log_message("💥", "BULK ERROR", error_msg)

    def _bulk_test_complete(self, count_good, total, total_time):
        # 🚀 FIX: Unlock the UI when the thread finishes
        self.btn_bulk.config(state="normal")
        self.btn_search.config(state="normal")

        # Clear the placeholder text
        for widget in self.scrollable_frame.winfo_children():
            widget.destroy()

        self.log_message("🏁", "TEST DONE", f"Passing: {count_good}/{total} | Time: {total_time:.2f}s")
        messagebox.showinfo("Bulk Test Complete",
                            f"Processed {total} images.\n{count_good} passed the threshold.\nBenchmark saved.",
                            parent=self.top)

    # --- FULLY RESTORED ORIGINAL LOGIC ---
    def create_match_card(self, result, rank):
        frame_card = tk.Frame(self.scrollable_frame, bd=2, relief="groove", padx=10, pady=10)
        frame_card.pack(fill="x", pady=5)

        score = result.get('score', 0)
        confidence = result.get('confidence', 0.0)
        tid = result.get('site_id', 'Unknown')

        score_color = "black"
        if score > 400:
            score_color = "green"
        elif score < 50:
            score_color = "red"

        frame_info = tk.Frame(frame_card)
        frame_info.pack(side="left", fill="y", padx=10)

        tk.Label(frame_info, text=f"Rank {rank}", font=("Arial", 10, "bold"), fg="#7f8c8d").pack(anchor="w")
        tk.Label(frame_info, text=f"ID: {tid}", font=("Arial", 14, "bold"), fg="#2c3e50").pack(anchor="w")
        tk.Label(frame_info, text=f"Matches: {score}", font=("Arial", 12, "bold"), fg=score_color).pack(anchor="w")
        tk.Label(frame_info, text=f"Conf: {confidence:.2f}", font=("Arial", 10), fg="#7f8c8d").pack(anchor="w")

        frame_actions = tk.Frame(frame_card)
        frame_actions.pack(side="right", padx=10)

        var_upgrade = tk.BooleanVar(value=False)
        chk_upgrade = tk.Checkbutton(frame_actions, text="This is a better\nreference image", variable=var_upgrade,
                                     justify="left")
        chk_upgrade.pack(pady=5)

        btn_confirm = tk.Button(frame_actions, text="✅ Confirm",
                                command=lambda r=result, v=var_upgrade: self.confirm_match(r, v.get()), bg="#2ecc71",
                                fg="white", font=("Arial", 11, "bold"), width=15)
        btn_confirm.pack(pady=5)

        lbl_img = tk.Label(frame_card, text="Image not found", bg="#dadada")
        lbl_img.pack(side="left", expand=True, fill="both", padx=20)

        pt_path = result.get('file_path')
        if pt_path:
            base = os.path.splitext(pt_path)[0]
            found = False
            for ext in ['.jpg', '.jpeg', '.png']:
                if os.path.exists(base + ext):
                    self.show_image(base + ext, lbl_img, size=(500, 300))
                    found = True
                    break
            if not found: lbl_img.config(text="Ref JPG Missing")

    def confirm_match(self, result, upgrade_reference):
        turtle_id = result.get('site_id')
        action = "Upgrade Reference" if upgrade_reference else "Add Observation"

        if messagebox.askyesno("Confirm", f"{action} for {turtle_id}?", parent=self.top):
            # Using your existing logic hook here
            req_id = manager.create_review_packet(self.query_path, user_info={'manual_admin': True})
            success, msg = manager.approve_review_packet(
                request_id=req_id,
                match_turtle_id=turtle_id,
                replace_reference=upgrade_reference
            )
            if success:
                messagebox.showinfo("Success", msg, parent=self.top)
                self.top.destroy()
            else:
                messagebox.showerror("Error", msg, parent=self.top)


class AdminDashboard:
    def __init__(self, root):
        self.root = root
        self.root.title("🐢 PicTur Admin Dashboard")
        self.root.geometry("600x600")
        self.root.configure(bg="#f0f0f0")

        header = tk.Label(root, text="TurtleVision ID System", font=("Arial", 18, "bold"), bg="#f0f0f0", fg="#2c3e50")
        header.pack(pady=20)

        # --- DEVICE TOGGLE UI ---
        frame_dev = tk.LabelFrame(root, text="Compute Device", font=("Arial", 10, "bold"), bg="white", padx=10, pady=10)
        frame_dev.pack(fill="x", padx=20, pady=5)

        self.device_var = tk.StringVar(value="GPU")
        tk.Radiobutton(frame_dev, text="GPU (Fast Processing)", variable=self.device_var, value="GPU",
                       command=self.change_device, bg="white").pack(side="left", padx=10)
        tk.Radiobutton(frame_dev, text="CPU (Slow Mode)", variable=self.device_var, value="CPU",
                       command=self.change_device, bg="white").pack(side="left", padx=10)

        frame_actions = tk.LabelFrame(root, text="Actions", font=("Arial", 10, "bold"), bg="white", padx=10, pady=10)
        frame_actions.pack(fill="both", expand=True, padx=20, pady=10)

        btn_bulk = tk.Button(frame_actions, text="📂 Bulk Ingest (Flash Drive)", command=self.command_bulk_ingest,
                             bg="#3498db", fg="white", font=("Arial", 11), height=2)
        btn_bulk.pack(fill="x", pady=5)

        btn_identify = tk.Button(frame_actions, text="🔍 Identify & Add Observation", command=self.open_identify_window,
                                 bg="#9b59b6", fg="white", font=("Arial", 11), height=2)
        btn_identify.pack(fill="x", pady=5)

        btn_manual = tk.Button(frame_actions, text="➕ Manual Upload (New Turtle)",
                               command=self.open_manual_upload_window, bg="#2ecc71", fg="white", font=("Arial", 11),
                               height=2)
        btn_manual.pack(fill="x", pady=5)

        self.status_var = tk.StringVar()
        self.status_var.set("System Ready")
        tk.Label(root, textvariable=self.status_var, bd=1, relief=tk.SUNKEN, anchor=tk.W).pack(side=tk.BOTTOM,
                                                                                               fill=tk.X)

    def change_device(self):
        mode = self.device_var.get()
        manager.set_device(mode)
        self.status_var.set(f"Device switched to {mode}")
        self.root.update()

    # --- FULLY RESTORED ORIGINAL LOGIC ---
    def command_bulk_ingest(self):
        drive_path = filedialog.askdirectory(title="Select Flash Drive Root")
        if drive_path:
            self.status_var.set("Ingesting... See Console.")
            self.root.update()
            manager.ingest_flash_drive(drive_path)
            messagebox.showinfo("Done", "Ingest Complete")
            self.status_var.set("System Ready")

    def open_identify_window(self):
        IdentifyWindow(self.root, self.device_var.get())

    def open_manual_upload_window(self):
        messagebox.showinfo("Info", "Feature in development.")


if __name__ == "__main__":
    root = tk.Tk()
    app = AdminDashboard(root)
    root.mainloop()