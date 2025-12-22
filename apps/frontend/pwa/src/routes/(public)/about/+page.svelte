<script lang="ts">
    import t from "$i18n";
</script>

<svelte:head>
    <title>{t.about_title()} - AI RPG</title>
    <meta name="description" content={t.about_description()} />
</svelte:head>

<!-- About page content - wrapped by AppView -->
<div class="container mx-auto p-6 space-y-12">
    <!-- Hero Section -->
    <div
        class="hero bg-gradient-to-r from-primary to-secondary text-primary-content rounded-lg"
    >
        <div class="hero-content text-center py-16">
            <div class="max-w-2xl">
                <h1 class="text-6xl font-bold">
                    {t.about_hero_title()}
                </h1>
                <p class="py-6 text-xl">
                    {t.about_hero_subtitle()}
                </p>
            </div>
        </div>
    </div>

    <!-- Mission Section -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div>
            <h2 class="text-4xl font-bold mb-6">
                {t.our_mission()}
            </h2>
            <p class="text-lg mb-4">
                {t.mission_description_1()}
            </p>
            <p class="text-lg">
                {t.mission_description_2()}
            </p>
        </div>
        <div class="flex justify-center">
            <div class="w-full max-w-md">
                <div class="card bg-base-100 shadow-xl">
                    <figure class="px-10 pt-10">
                        <div
                            class="w-32 h-32 rounded-full bg-gradient-to-r from-primary to-secondary flex items-center justify-center"
                        >
                            <span class="text-4xl">🤖</span>
                        </div>
                    </figure>
                    <div class="card-body items-center text-center">
                        <h3 class="card-title">
                            {t.ai_powered()}
                        </h3>
                        <p>
                            {t.ai_powered_description()}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Features Section -->
    <div class="space-y-8">
        <h2 class="text-4xl font-bold text-center">
            {t.what_we_offer()}
        </h2>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <div class="card bg-base-100 shadow-xl">
                <div class="card-body items-center text-center">
                    <div class="text-4xl mb-4">💬</div>
                    <h3 class="card-title">
                        {t.intelligent_conversations()}
                    </h3>
                    <p>
                        {t.intelligent_conversations_description()}
                    </p>
                </div>
            </div>

            <div class="card bg-base-100 shadow-xl">
                <div class="card-body items-center text-center">
                    <div class="text-4xl mb-4">🎨</div>
                    <h3 class="card-title">
                        {t.image_generation()}
                    </h3>
                    <p>
                        {t.image_generation_description()}
                    </p>
                </div>
            </div>

            <div class="card bg-base-100 shadow-xl">
                <div class="card-body items-center text-center">
                    <div class="text-4xl mb-4">🎮</div>
                    <h3 class="card-title">
                        {t.cross_platform()}
                    </h3>
                    <p>
                        {t.cross_platform_description()}
                    </p>
                </div>
            </div>

            <div class="card bg-base-100 shadow-xl">
                <div class="card-body items-center text-center">
                    <div class="text-4xl mb-4">📱</div>
                    <h3 class="card-title">
                        {t.progressive_web_app()}
                    </h3>
                    <p>
                        {t.progressive_web_app_description()}
                    </p>
                </div>
            </div>

            <div class="card bg-base-100 shadow-xl">
                <div class="card-body items-center text-center">
                    <div class="text-4xl mb-4">☁️</div>
                    <h3 class="card-title">
                        {t.cloud_sync()}
                    </h3>
                    <p>
                        {t.cloud_sync_description()}
                    </p>
                </div>
            </div>

            <div class="card bg-base-100 shadow-xl">
                <div class="card-body items-center text-center">
                    <div class="text-4xl mb-4">🌍</div>
                    <h3 class="card-title">
                        {t.multilingual()}
                    </h3>
                    <p>
                        {t.multilingual_description()}
                    </p>
                </div>
            </div>
        </div>
    </div>

    <!-- Technology Section -->
    <div class="bg-base-100 rounded-lg p-8">
        <h2 class="text-4xl font-bold text-center mb-8">
            {t.powered_by()}
        </h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-8">
            <div class="text-center">
                <div class="text-3xl mb-2">⚡</div>
                <h4 class="font-semibold">SvelteKit</h4>
                <p class="text-sm opacity-70">
                    {t.modern_web_framework()}
                </p>
            </div>
            <div class="text-center">
                <div class="text-3xl mb-2">🔥</div>
                <h4 class="font-semibold">Firebase</h4>
                <p class="text-sm opacity-70">
                    {t.real_time_database()}
                </p>
            </div>
            <div class="text-center">
                <div class="text-3xl mb-2">🧠</div>
                <h4 class="font-semibold">AI/ML</h4>
                <p class="text-sm opacity-70">
                    {t.advanced_ai_models()}
                </p>
            </div>
            <div class="text-center">
                <div class="text-3xl mb-2">🎮</div>
                <h4 class="font-semibold">Godot</h4>
                <p class="text-sm opacity-70">
                    {t.game_engine()}
                </p>
            </div>
        </div>
    </div>

    <!-- CTA Section -->
    <div class="text-center space-y-6">
        <h2 class="text-4xl font-bold">
            {t.ready_to_start()}
        </h2>
        <p class="text-xl opacity-80">
            {t.join_adventure()}
        </p>
        <div class="flex justify-center gap-4">
            <a href="/register" class="btn btn-primary btn-lg"
                >{t.get_started()}</a
            >
            <a href="/login" class="btn btn-outline btn-lg">{t.sign_in()}</a>
        </div>
    </div>
</div>
